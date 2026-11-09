/**
 * Bank state descriptions and strict notification parsing.
 * Durable inbox reconciliation, not generic Medusa webhook actions, owns
 * payment transitions and order creation.
 */
import type { PaymentSessionStatus } from "@medusajs/types";

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

  // A bank hold must not authorize Medusa order creation before CONFIRMED.
  AUTHORIZED: "pending_authorization",
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
  const success = payload["Success"];

  if (typeof orderId !== "string" || orderId.length === 0) {
    throw new Error("TBank notification: отсутствует OrderId");
  }
  if (typeof status !== "string" || status.length === 0) {
    throw new Error("TBank notification: отсутствует Status");
  }
  if (typeof success !== "boolean") {
    throw new Error("TBank notification: отсутствует или некорректен Success");
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
    success,
    errorCode:
      typeof payload["ErrorCode"] === "string" ? payload["ErrorCode"] : undefined,
    message:
      typeof payload["Message"] === "string" ? payload["Message"] : undefined,
  };
}

