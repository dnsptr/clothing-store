/**
 * Отображение статусов Т-Банка на состояния Medusa.
 *
 * Здесь сосредоточена самая дорогая ошибка всей интеграции, поэтому правила
 * зафиксированы в проектном решении (docs/design/
 * tbank-payments-and-fiscalization.md, §4) и повторены здесь как код.
 *
 * Ключевой факт, из-за которого таблица выглядит именно так: штатный
 * сабскрайбер Medusa (`payment-webhook`) делает ранний `return` на пяти
 * значениях `PaymentActions` из восьми, а `processPaymentWorkflow` в последней
 * ветке `when` **не проверяет action вообще** — любой дошедший до воркфлоу
 * action при связанной корзине и отсутствующем заказе завершает корзину и
 * создаёт заказ.
 *
 * Отсюда правило §4.2: всё, что не является терминальным исходом платежа,
 * возвращается как `not_supported` — единственное значение, гарантированно не
 * имеющее сайд-эффектов. Смапить `NEW`/`FORM_SHOWED` в `pending` означало бы
 * создавать заказ по неоплаченной корзине в тот момент, когда покупатель лишь
 * открыл платёжную форму.
 */

import type { PaymentActions, PaymentSessionStatus } from "@medusajs/types";

import { kopecksToRubles } from "./money";

/**
 * Статусы Т-Банка, встречающиеся в нотификациях одностадийной оплаты
 * (`PayType: O`). Список закрытый: неизвестное значение обрабатывается
 * отдельно и намеренно консервативно.
 */
export const TBANK_STATUSES = [
  "NEW",
  "FORM_SHOWED",
  "AUTHORIZING",
  "3DS_CHECKING",
  "AUTHORIZED",
  "CONFIRMED",
  "REJECTED",
  "DEADLINE_EXPIRED",
  "CANCELED",
  "REVERSED",
  "REFUNDED",
  "PARTIAL_REFUNDED",
] as const;

export type TBankStatus = (typeof TBANK_STATUSES)[number];

export function isTBankStatus(value: unknown): value is TBankStatus {
  return (
    typeof value === "string" &&
    (TBANK_STATUSES as readonly string[]).includes(value)
  );
}

/**
 * Таблица §4.3 — статус Т-Банка → команда фреймворку.
 *
 * `pending` не встречается в таблице намеренно (§4.2), `pending_authorization`
 * — тоже: как action он no-op, а как *статус сессии* осмыслен и живёт в
 * `toSessionStatus` ниже.
 */
const ACTION_BY_STATUS: Record<TBankStatus, PaymentActions> = {
  // Покупатель ещё ничего не оплатил — фреймворк не должен делать ничего.
  NEW: "not_supported",
  FORM_SHOWED: "not_supported",
  AUTHORIZING: "not_supported",
  "3DS_CHECKING": "not_supported",

  // Терминальные успешные исходы — единственные, что доезжают до воркфлоу.
  AUTHORIZED: "authorized",
  CONFIRMED: "captured",

  // Штатный путь эти значения отбрасывает; их обрабатывает собственный
  // сабскрайбер (§4.4). Возвращать их всё равно правильно: это честное
  // описание произошедшего, и именно на них подписан наш обработчик.
  REJECTED: "failed",
  DEADLINE_EXPIRED: "failed",
  CANCELED: "canceled",
  REVERSED: "canceled",

  // Возвраты — отдельный контур (§8), через webhook action не проводятся.
  REFUNDED: "not_supported",
  PARTIAL_REFUNDED: "not_supported",
};

/**
 * Статус Т-Банка → команда Medusa. Неизвестный статус — `not_supported`.
 *
 * Консервативный дефолт здесь принципиален: банк может ввести новый статус
 * раньше, чем мы обновим код, и цена ошибки несимметрична. Лишний
 * `not_supported` означает «Medusa ничего не сделала», лишний `authorized` —
 * «создан заказ по неоплаченной корзине».
 */
export function toWebhookAction(status: string): PaymentActions {
  return isTBankStatus(status) ? ACTION_BY_STATUS[status] : "not_supported";
}

/**
 * Статус Т-Банка → состояние платёжной сессии Medusa.
 *
 * Используется в `getPaymentStatus`, когда состояние выясняется опросом
 * (`GetState`), а не нотификацией. Здесь набор значений другой
 * (`PaymentSessionStatus`, не `PaymentActions`) и смысл другой: это описание
 * состояния, а не команда, поэтому нетерминальные статусы отображаются
 * содержательно, а не в no-op.
 */
const SESSION_STATUS_BY_STATUS: Record<TBankStatus, PaymentSessionStatus> = {
  // «Покупатель ушёл на платёжную форму, ответа ещё нет» — ровно то состояние,
  // для которого в 2.17.2 существует `pending_authorization` (§2).
  NEW: "pending_authorization",
  FORM_SHOWED: "pending_authorization",
  AUTHORIZING: "pending_authorization",
  "3DS_CHECKING": "pending_authorization",

  AUTHORIZED: "authorized",
  CONFIRMED: "captured",

  REJECTED: "error",
  DEADLINE_EXPIRED: "error",

  CANCELED: "canceled",
  REVERSED: "canceled",

  // Возврат не отменяет того, что деньги были списаны: сессия остаётся
  // captured, а возврат учитывается отдельной сущностью Medusa (§8).
  REFUNDED: "captured",
  PARTIAL_REFUNDED: "captured",
};

export function toSessionStatus(status: string): PaymentSessionStatus {
  return isTBankStatus(status)
    ? SESSION_STATUS_BY_STATUS[status]
    : "pending";
}

/**
 * Порядок состояний для монотонных переходов (§5.1).
 *
 * При одностадийной оплате банк отправляет `AUTHORIZED` и `CONFIRMED`
 * **одновременно** и ждёт ответа 10 секунд — они приходят параллельно и в
 * произвольном порядке. Это документированное поведение, а не редкая гонка.
 *
 * Поэтому обработчик обязан сравнивать состояния по порядку, а не по принципу
 * «последнее выигрывает»: иначе пришедший вторым `AUTHORIZED` откатит уже
 * зафиксированный `CONFIRMED`, и заказ окажется оплаченным, но не списанным.
 *
 * Неуспешные терминальные исходы стоят на одном уровне с `CONFIRMED`: после
 * списания отказ прийти уже не может, а до него — любой из них финален.
 */
const STATUS_RANK: Record<TBankStatus, number> = {
  NEW: 0,
  FORM_SHOWED: 1,
  AUTHORIZING: 2,
  "3DS_CHECKING": 2,
  AUTHORIZED: 3,
  CONFIRMED: 4,
  REJECTED: 4,
  DEADLINE_EXPIRED: 4,
  CANCELED: 4,
  REVERSED: 4,
  // Возврат наступает только после списания.
  PARTIAL_REFUNDED: 5,
  REFUNDED: 6,
};

export function statusRank(status: string): number {
  return isTBankStatus(status) ? STATUS_RANK[status] : -1;
}

/**
 * Является ли переход откатом назад (и, значит, подлежит игнорированию).
 *
 * Неизвестный статус получает ранг −1, поэтому переход в него считается
 * регрессом и игнорируется — тот же консервативный дефолт, что и в
 * `toWebhookAction`.
 */
export function isStatusRegression(from: string, to: string): boolean {
  return statusRank(to) <= statusRank(from);
}

/** Разобранная нотификация в объёме, который нужен для §4.5. */
export type TBankNotification = {
  orderId: string;
  paymentId: string;
  status: string;
  /** Сумма в копейках, как её прислал банк. */
  amountKopecks: number;
  success: boolean;
  errorCode?: string;
  message?: string;
};

/**
 * Разбор тела нотификации.
 *
 * Подпись здесь не проверяется — это делает вызывающий код через
 * `verifyNotificationToken` до разбора (§5.4). Разделение намеренное: проверка
 * подписи не должна зависеть от того, сумели ли мы разобрать поля.
 *
 * `Amount` в нотификациях об отмене может отсутствовать — тогда 0, и решение о
 * сумме принимает вызывающий код по сохранённой сессии.
 */
export function parseNotification(
  payload: Record<string, unknown>,
): TBankNotification {
  const orderId = payload["OrderId"];
  const paymentId = payload["PaymentId"];
  const status = payload["Status"];
  const amount = payload["Amount"];

  if (typeof orderId !== "string" || orderId.length === 0) {
    throw new Error("TBank notification: отсутствует OrderId");
  }
  if (typeof status !== "string" || status.length === 0) {
    throw new Error("TBank notification: отсутствует Status");
  }

  // PaymentId банк присылает и числом, и строкой в зависимости от метода.
  const normalizedPaymentId =
    typeof paymentId === "number"
      ? String(paymentId)
      : typeof paymentId === "string"
        ? paymentId
        : "";
  if (normalizedPaymentId.length === 0) {
    throw new Error("TBank notification: отсутствует PaymentId");
  }

  let amountKopecks = 0;
  if (typeof amount === "number") {
    if (!Number.isSafeInteger(amount) || amount < 0) {
      throw new Error(`TBank notification: некорректный Amount: ${amount}`);
    }
    amountKopecks = amount;
  } else if (typeof amount === "string" && amount.length > 0) {
    const parsed = Number(amount);
    if (!Number.isSafeInteger(parsed) || parsed < 0) {
      throw new Error(`TBank notification: некорректный Amount: ${amount}`);
    }
    amountKopecks = parsed;
  }

  return {
    orderId,
    paymentId: normalizedPaymentId,
    status,
    amountKopecks,
    success: payload["Success"] === true,
    errorCode:
      typeof payload["ErrorCode"] === "string" ? payload["ErrorCode"] : undefined,
    message:
      typeof payload["Message"] === "string" ? payload["Message"] : undefined,
  };
}

/**
 * Нотификация → результат для `getWebhookActionAndData` (§4.5).
 *
 * `session_id` берётся из `OrderId` — по §5.3 туда кладётся идентификатор
 * платёжной сессии Medusa, а не корзины. `amount` конвертируется в рубли
 * единственной функцией конверсии: это значение уходит в
 * `capturePaymentWorkflow` как сумма списания, поэтому ошибка масштаба здесь —
 * это списание в сто раз больше или меньше.
 */
export function toWebhookActionAndData(notification: TBankNotification): {
  action: PaymentActions;
  data: { session_id: string; amount: string };
} {
  return {
    action: toWebhookAction(notification.status),
    data: {
      session_id: notification.orderId,
      amount: kopecksToRubles(notification.amountKopecks),
    },
  };
}
