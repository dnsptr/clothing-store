/**
 * Платёжный провайдер Т-Банка (шаг 1 в §12.2 проектного решения).
 *
 * Что здесь есть: создание платежа, опрос состояния, отмена/возврат и разбор
 * нотификаций. Чего здесь ещё нет и почему:
 *
 * - **Чек (`Receipt`)** — шаг 3. Требует ответов бухгалтера (§9, вопросы
 *   Q1–Q5: `vat5` vs `vat105`, тег 1055, признаки 1212/1214) и закрытия
 *   открытого вопроса §6.1 о том, откуда провайдер берёт позиции: в контракте
 *   `IPaymentProvider` нет ни line items, ни `cart_id`. До этого момента
 *   сквозная оплата возможна только на терминале без подключённой кассы.
 * - **Дедупликация нотификаций** — шаг 6, требует явного выбора между
 *   вариантами А и Б в §5.2. Здесь провайдер только разбирает и отображает
 *   нотификацию; хранение пары `(PaymentId, Status)` — забота роута.
 *
 * Опциональные методы контракта (`*AccountHolder`, `listPaymentMethods`,
 * `savePaymentMethod`, `deletePaymentMethod`) не реализованы намеренно: они
 * про сохранённые карты, а это `Recurrent=Y`, `CustomerKey`,
 * `OperationInitiatorType` и отдельный разговор про 152-ФЗ (§2).
 */

import { AbstractPaymentProvider, MedusaError } from "@medusajs/framework/utils";
import type { Logger } from "@medusajs/framework/types";
import type {
  AuthorizePaymentInput,
  AuthorizePaymentOutput,
  CancelPaymentInput,
  CancelPaymentOutput,
  CapturePaymentInput,
  CapturePaymentOutput,
  DeletePaymentInput,
  DeletePaymentOutput,
  GetPaymentStatusInput,
  GetPaymentStatusOutput,
  InitiatePaymentInput,
  InitiatePaymentOutput,
  PaymentSessionStatus,
  ProviderWebhookPayload,
  RefundPaymentInput,
  RefundPaymentOutput,
  RetrievePaymentInput,
  RetrievePaymentOutput,
  UpdatePaymentInput,
  UpdatePaymentOutput,
  WebhookActionResult,
} from "@medusajs/types";

import { TBankApiError, TBankClient } from "./lib/client";
import { rublesToKopecks } from "./lib/money";
import {
  parseNotification,
  toSessionStatus,
  toWebhookActionAndData,
} from "./lib/status";
import { verifyNotificationToken } from "./lib/token";

export type TBankOptions = {
  terminalKey: string;
  password: string;
  apiBaseUrl?: string;
  successUrl?: string;
  failUrl?: string;
  notificationUrl?: string;
  timeoutMs?: number;
};

type InjectedDependencies = {
  logger: Logger;
};

const DEFAULT_API_BASE_URL = "https://securepay.tinkoff.ru/v2";

/** Данные, которые провайдер хранит в `data` платёжной сессии. */
type TBankSessionData = {
  paymentId?: string;
  paymentUrl?: string;
  orderId?: string;
  status?: string;
};

export class TBankPaymentProviderService extends AbstractPaymentProvider<TBankOptions> {
  static identifier = "tbank";

  protected readonly logger_: Logger;
  protected readonly options_: TBankOptions;
  protected readonly client_: TBankClient;

  /**
   * Валидация опций на старте приложения, а не при первой оплате. Терминал без
   * пароля — это конфигурационная ошибка, и обнаружить её в момент, когда
   * покупатель нажал «Оплатить», заметно дороже.
   */
  static validateOptions(options: Record<string, unknown>): void {
    if (!options.terminalKey || typeof options.terminalKey !== "string") {
      throw new MedusaError(
        MedusaError.Types.INVALID_ARGUMENT,
        "tbank: требуется terminalKey (TBANK_TERMINAL_KEY)",
      );
    }
    if (!options.password || typeof options.password !== "string") {
      throw new MedusaError(
        MedusaError.Types.INVALID_ARGUMENT,
        "tbank: требуется password (TBANK_PASSWORD)",
      );
    }
  }

  constructor(container: InjectedDependencies, options: TBankOptions) {
    super(container, options);
    this.logger_ = container.logger;
    this.options_ = options;
    this.client_ = new TBankClient(
      {
        terminalKey: options.terminalKey,
        password: options.password,
        apiBaseUrl: options.apiBaseUrl ?? DEFAULT_API_BASE_URL,
      },
      options.timeoutMs,
    );
  }

  getIdentifier(): string {
    return TBankPaymentProviderService.identifier;
  }

  /**
   * Создание платежа.
   *
   * `OrderId` — идентификатор платёжной сессии Medusa, а не корзины (§5.3):
   * корзина переживает неудачную оплату, сессия — нет, а банк требует
   * уникальности на операцию. Лимит банка 36 символов, `payses_` + ULID даёт
   * 33 — с запасом.
   *
   * Возвращается `pending_authorization`: покупатель уходит на платёжную форму
   * банка, и до нотификации исход неизвестен. Это ровно то состояние, ради
   * которого значение появилось в 2.17.2 (§2).
   */
  async initiatePayment(input: InitiatePaymentInput): Promise<InitiatePaymentOutput> {
    const sessionId = this.resolveSessionId_(input);
    const amountKopecks = rublesToKopecks(input.amount);

    if (input.currency_code.toLowerCase() !== "rub") {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `tbank: поддерживается только RUB, получено ${input.currency_code}`,
      );
    }

    try {
      const result = await this.client_.init({
        orderId: sessionId,
        amountKopecks,
        successUrl: this.options_.successUrl,
        failUrl: this.options_.failUrl,
        notificationUrl: this.options_.notificationUrl,
        // Receipt появится на шаге 3 (§12.2). См. заголовок файла.
      });

      const data: TBankSessionData = {
        paymentId: result.PaymentId,
        paymentUrl: result.PaymentURL,
        orderId: sessionId,
        status: result.Status,
      };

      return {
        id: result.PaymentId ?? sessionId,
        status: "pending_authorization",
        data: data as unknown as Record<string, unknown>,
      };
    } catch (error) {
      this.logger_.error(
        `tbank: Init не прошёл для сессии ${sessionId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      throw error;
    }
  }

  /**
   * Опрос состояния. Используется, когда покупатель вернулся на витрину
   * раньше, чем пришла нотификация, и для сверки (PAY-005).
   *
   * Если `PaymentId` ещё нет — платёж не создан, и это `pending`, а не ошибка.
   */
  async getPaymentStatus(input: GetPaymentStatusInput): Promise<GetPaymentStatusOutput> {
    const data = (input.data ?? {}) as TBankSessionData;
    if (!data.paymentId) {
      return { status: "pending", data: input.data };
    }

    const result = await this.client_.getState(data.paymentId);
    return {
      status: toSessionStatus(result.Status ?? ""),
      data: { ...data, status: result.Status } as unknown as Record<string, unknown>,
    };
  }

  /**
   * Разбор нотификации.
   *
   * Подпись проверяется здесь и до всего остального (§5.4). Несовпадение — это
   * не «неуспешный платёж», а подделка либо расхождение конфигурации, поэтому
   * возвращается `not_supported`: Medusa не должна сделать ничего.
   *
   * Токен считается по разобранным полям, а не по байтам тела, поэтому
   * `rawData` здесь не нужен.
   */
  async getWebhookActionAndData(
    payload: ProviderWebhookPayload["payload"],
  ): Promise<WebhookActionResult> {
    const body = payload.data as Record<string, unknown>;

    if (!verifyNotificationToken(body, this.options_.password)) {
      this.logger_.warn(
        `tbank: нотификация с неверной подписью, OrderId=${String(body?.["OrderId"])}`,
      );
      return { action: "not_supported" };
    }

    let notification: ReturnType<typeof parseNotification>;
    try {
      notification = parseNotification(body);
    } catch (error) {
      this.logger_.warn(
        `tbank: нотификация не разобрана: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return { action: "not_supported" };
    }

    const result = toWebhookActionAndData(notification);
    this.logger_.info(
      `tbank: нотификация ${notification.status} по сессии ${notification.orderId} → ${result.action}`,
    );
    return result;
  }

  /**
   * При одностадийной оплате (`PayType: O`) отдельного списания нет: банк
   * присылает `AUTHORIZED` и `CONFIRMED` одновременно, деньги списаны к
   * моменту второй нотификации. Метод обязан быть корректным, но работы не
   * выполняет — подтверждать нечего.
   */
  async capturePayment(input: CapturePaymentInput): Promise<CapturePaymentOutput> {
    return { data: input.data };
  }

  /**
   * Авторизация. Состояние выясняется живым `GetState`, а не полем `status` из
   * данных сессии.
   *
   * Это не перестраховка. `data.status` пишется ровно один раз — в
   * `initiatePayment`, из ответа `Init`, — то есть навсегда остаётся `NEW`.
   * Обновить его некому: `getPaymentStatus` фреймворк 2.17.2 сам не вызывает, а
   * нотификация приходит в наш роут, который данных сессии не трогает. Дальше
   * протухшее `NEW` даёт `pending_authorization`, на нём
   * `authorizePaymentSessionStep` возвращает `null`, `capturePaymentWorkflow`
   * получает `payment_id: undefined` и падает — заказ остаётся неоплаченным
   * навсегда, при списанных деньгах (аудит 2026-07-27).
   *
   * Поэтому здесь тот же путь, что и в `getPaymentStatus`: спросить банк и
   * вернуть его ответ, сохранив свежий `Status` в `data`. Отвечая `captured` на
   * `CONFIRMED`, мы попадаем в ветку автосписания модуля платежей — он сам
   * создаёт `Payment` и закрывает списание.
   *
   * Банк может не ответить, и недоступность банка — не исход платежа. Падение
   * здесь означало бы сорванное оформление на ровном месте, поэтому сетевая
   * ошибка `GetState` не выпускается наружу: возвращается последнее известное
   * состояние, сессия остаётся в ожидании, а исход доберут повторная
   * нотификация и сверка (PAY-005) — та же дисциплина «не ронять», что в
   * `cancelPayment`.
   */
  async authorizePayment(input: AuthorizePaymentInput): Promise<AuthorizePaymentOutput> {
    const data = (input.data ?? {}) as TBankSessionData;

    // Платежа в банке нет — спрашивать не о чем, и это не ошибка: сессия просто
    // не дошла до `Init`. Прежнее поведение сохранено осознанно.
    if (!data.paymentId) {
      return { status: this.knownSessionStatus_(data), data: input.data };
    }

    try {
      const result = await this.getPaymentStatus(input);
      return { status: result.status, data: result.data };
    } catch (error) {
      this.logger_.warn(
        `tbank: GetState при авторизации платежа ${data.paymentId} не прошёл (${
          error instanceof Error ? error.message : String(error)
        }), возвращено последнее известное состояние`,
      );
      return { status: this.knownSessionStatus_(data), data: input.data };
    }
  }

  /**
   * Отмена до списания. У Т-Банка отмена и возврат — один метод `Cancel`,
   * различает их сам банк по текущему состоянию платежа.
   */
  async cancelPayment(input: CancelPaymentInput): Promise<CancelPaymentOutput> {
    const data = (input.data ?? {}) as TBankSessionData;
    if (!data.paymentId) {
      // Платёж не создавался — отменять нечего, и это не ошибка.
      return { data: input.data };
    }

    try {
      await this.client_.cancel({ paymentId: data.paymentId });
    } catch (error) {
      // Отмена уже отменённого платежа не должна валить оформление.
      if (error instanceof TBankApiError) {
        this.logger_.warn(`tbank: Cancel вернул ${error.errorCode}: ${error.message}`);
        return { data: input.data };
      }
      throw error;
    }

    return { data: input.data };
  }

  /**
   * Возврат.
   *
   * ВНИМАНИЕ. Возврат по 54-ФЗ требует **возвратного чека** — `Cancel` с
   * `Receipt` (§8). Пока `buildReceipt` не реализован (шаг 3), этот метод
   * возвращает деньги, но не пробивает чек. На терминале с подключённой кассой
   * это нарушение, поэтому до шага 3 возвраты проводятся через личный кабинет
   * банка, а не отсюда.
   */
  async refundPayment(input: RefundPaymentInput): Promise<RefundPaymentOutput> {
    const data = (input.data ?? {}) as TBankSessionData;
    if (!data.paymentId) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "tbank: возврат невозможен — в сессии нет PaymentId",
      );
    }

    await this.client_.cancel({
      paymentId: data.paymentId,
      amountKopecks: rublesToKopecks(input.amount),
    });

    return { data: input.data };
  }

  async retrievePayment(input: RetrievePaymentInput): Promise<RetrievePaymentOutput> {
    const data = (input.data ?? {}) as TBankSessionData;
    if (!data.paymentId) {
      return { data: input.data };
    }
    const result = await this.client_.getState(data.paymentId);
    return {
      data: { ...data, status: result.Status } as unknown as Record<string, unknown>,
    };
  }

  /**
   * Сумма платежа в Т-Банке после `Init` не меняется. Обновление означает, что
   * корзина изменилась, — тогда создаётся новая сессия, а старая удаляется.
   * Поэтому здесь только перенос данных.
   */
  async updatePayment(input: UpdatePaymentInput): Promise<UpdatePaymentOutput> {
    return { data: input.data };
  }

  /** Удаление сессии = отмена платежа, если он был создан. */
  async deletePayment(input: DeletePaymentInput): Promise<DeletePaymentOutput> {
    await this.cancelPayment(input);
    return { data: input.data };
  }

  /**
   * Последнее известное состояние сессии — ответ на случай, когда банк спросить
   * не удалось.
   *
   * Пустой `status` означает «платёж ещё в пути», а не «платёж неуспешен»:
   * `pending_authorization` оставляет сессию ожидающей и обратимой, тогда как
   * `error` закрыл бы её отказом из-за проблем с сетью на нашей стороне.
   */
  private knownSessionStatus_(data: TBankSessionData): PaymentSessionStatus {
    return data.status ? toSessionStatus(data.status) : "pending_authorization";
  }

  /**
   * Идентификатор операции для банка.
   *
   * Medusa передаёт `context.idempotency_key`; он и есть id платёжной сессии
   * на этом пути. Отсутствие ключа — это баг вызывающего кода, а не повод
   * придумать случайный OrderId: случайный означал бы, что повтор запроса
   * создаёт второй платёж.
   */
  private resolveSessionId_(input: InitiatePaymentInput): string {
    const key = input.context?.idempotency_key;
    if (typeof key === "string" && key.length > 0) {
      return key.slice(0, 36);
    }
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "tbank: не передан idempotency_key — невозможно построить уникальный OrderId",
    );
  }
}

export default TBankPaymentProviderService;
