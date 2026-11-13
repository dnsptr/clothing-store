/**
 * Платёжный провайдер Т-Банка: создание платежа, опрос состояния,
 * отмена/возврат и разбор нотификаций.
 *
 * Подписанный webhook и дедупликация пары `(PaymentId, Status)` реализованы
 * отдельно в маршруте и PostgreSQL inbox.
 *
 * Опциональные методы контракта (`*AccountHolder`, `listPaymentMethods`,
 * `savePaymentMethod`, `deletePaymentMethod`) не реализованы намеренно: они
 * про сохранённые карты, а это `Recurrent=Y`, `CustomerKey`,
 * `OperationInitiatorType` и отдельный разговор про 152-ФЗ (§2).
 */

import { container as applicationContainer } from "@medusajs/framework";
import { AbstractPaymentProvider, ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils";
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
  ProviderWebhookPayload,
  RefundPaymentInput,
  RefundPaymentOutput,
  RetrievePaymentInput,
  RetrievePaymentOutput,
  UpdatePaymentInput,
  UpdatePaymentOutput,
  WebhookActionResult,
} from "@medusajs/types";

import { TBankApiError, TBankClient, type TBankGetStateResult } from "./lib/client";
import { rublesToKopecks } from "./lib/money";
import { TBankReceiptSource, type ReceiptQuery } from "./lib/receipt-source";
import { isStrongReceiptSnapshotSecret } from "./lib/receipt-snapshot";
import { TBankAttemptPersistenceError } from "./errors";
import { toSessionStatus } from "./lib/status";
import { validateBankState } from "./services/reconciliation-trust";
import {
  TBANK_PAYMENT_PROVIDER_ID,
  TBANK_PROVIDER_IDENTIFIER,
} from "./provider-id";

export type TBankOptions = {
  terminalKey: string;
  password: string;
  readonly receiptSnapshotSecret: string;
  apiBaseUrl?: string;
  successUrl?: string;
  failUrl?: string;
  notificationUrl?: string;
  timeoutMs?: number;
};

import { TBANK_NOTIFICATION_MODULE } from "../tbank-notifications";
import type { TbankNotificationStore } from "../tbank-notifications/lifecycle";
import { CHECKOUT_HOLD_MODULE, type PaymentCheckoutHolds } from "../checkout-holds/contracts";

export type InjectedDependencies = {
  logger: Logger;
  query?: ReceiptQuery;
  [TBANK_NOTIFICATION_MODULE]?: TbankNotificationStore;
  [CHECKOUT_HOLD_MODULE]?: PaymentCheckoutHolds;
  [key: string]: unknown;
};

function providerDependency<T>(
  injected: InjectedDependencies,
  key: string,
  optional = false,
): T | undefined {
  // Medusa creates payment providers in the payment module's own Awilix
  // container. Application-level query and custom modules live in the app
  // container, not that cradle; accessing an absent cradle key throws.
  let value: T | undefined;
  try {
    value = injected[key] as T | undefined;
  } catch (error) {
    if (!(error instanceof Error) || error.name !== "AwilixResolutionError") {
      throw error;
    }
  }
  return value ?? applicationContainer.resolve<T>(key, { allowUnregistered: optional });
}

const DEFAULT_API_BASE_URL = "https://securepay.tinkoff.ru/v2";

export const APPROVED_PAYMENT_URL_HOSTNAMES = new Set([
  "securepay.tinkoff.ru",
  "rest-api-test.tinkoff.ru",
  "pay.tbank-online.com",
]);

export function validatePaymentUrl(urlStr?: string): void {
  if (!urlStr || typeof urlStr !== "string") {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "tbank: ответ Init не содержит PaymentURL",
    );
  }
  let parsed: URL;
  try {
    parsed = new URL(urlStr);
  } catch {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `tbank: некорректный PaymentURL: ${urlStr}`,
    );
  }
  if (parsed.protocol !== "https:") {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `tbank: PaymentURL должен использовать протокол https, получено: ${parsed.protocol}`,
    );
  }
  if (parsed.username || parsed.password) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "tbank: PaymentURL не должен содержать учётные данные пользователя",
    );
  }
  if (!APPROVED_PAYMENT_URL_HOSTNAMES.has(parsed.hostname.toLowerCase())) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `tbank: непроверенный хост PaymentURL: ${parsed.hostname}`,
    );
  }
  if (parsed.port && parsed.port !== "443") {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "tbank: PaymentURL должен использовать стандартный HTTPS-порт",
    );
  }
}

export type CartSnapshot = {
  readonly cartId?: string;
  readonly amountKopecks: number;
  readonly currencyCode: string;
  readonly orderId: string;
};

/** Данные, которые провайдер хранит в `data` платёжной сессии. */
export type TBankSessionData = {
  paymentId?: string;
  paymentUrl?: string;
  orderId?: string;
  status?: string;
  attemptId?: string;
  cartSnapshot?: CartSnapshot;
  initiatedAt?: string;
  paymentExpiresAt?: string;
  indeterminateReason?: string;
  receiptSnapshotEnvelope?: string;
};

export class TBankPaymentProviderService extends AbstractPaymentProvider<TBankOptions> {
  static identifier = TBANK_PROVIDER_IDENTIFIER;

  protected readonly logger_: Logger;
  protected readonly options_: TBankOptions;
  protected readonly client_: TBankClient;
  protected readonly receiptSource_: TBankReceiptSource;
  protected readonly notificationService_?: TbankNotificationStore;
  protected readonly checkoutHolds_: PaymentCheckoutHolds;
  private static readonly inFlightInitiations_ = new Map<string, {
    readonly amountKopecks: number;
    readonly currencyCode: string;
    readonly promise: Promise<InitiatePaymentOutput>;
  }>();

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
    if (
      typeof options.receiptSnapshotSecret !== "string" ||
      !isStrongReceiptSnapshotSecret(options.receiptSnapshotSecret) ||
      options.receiptSnapshotSecret === options.password
    ) {
      throw new MedusaError(
        MedusaError.Types.INVALID_ARGUMENT,
        "tbank: требуется отдельный высокоэнтропийный TBANK_RECEIPT_SNAPSHOT_SECRET",
      );
    }
  }

  constructor(container: InjectedDependencies, options: TBankOptions) {
    super(container, options);
    this.logger_ = container.logger;
    const query = providerDependency<ReceiptQuery>(container, ContainerRegistrationKeys.QUERY);
    if (!query) throw new Error("tbank: application query is not registered");
    this.receiptSource_ = new TBankReceiptSource(query, options.receiptSnapshotSecret);
    this.options_ = options;
    this.notificationService_ = providerDependency<TbankNotificationStore>(
      container, TBANK_NOTIFICATION_MODULE, true,
    );
    this.checkoutHolds_ = providerDependency<PaymentCheckoutHolds>(container, CHECKOUT_HOLD_MODULE)!;
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
    const currencyCode = input.currency_code.toLowerCase();
    const approvedTotal = input.data?.expected_total;
    if (approvedTotal !== undefined &&
        (typeof approvedTotal !== "number" || rublesToKopecks(approvedTotal) !== amountKopecks)) {
      throw new MedusaError(MedusaError.Types.CONFLICT, "Стоимость заказа изменилась после подтверждения. Проверьте итог перед оплатой");
    }
    const inFlight = TBankPaymentProviderService.inFlightInitiations_.get(sessionId);
    if (inFlight) {
      if (inFlight.amountKopecks !== amountKopecks || inFlight.currencyCode !== currencyCode) {
        throw new MedusaError(
          MedusaError.Types.CONFLICT,
          "tbank: параллельная инициализация той же сессии с другой суммой или валютой",
        );
      }
      this.logger_.info(
        `tbank: параллельный вызов initiatePayment для сессии ${sessionId} обнаружен, ожидаем завершения первого запроса`,
      );
      return inFlight.promise;
    }

    const promise = this.executeInitiatePayment_(sessionId, input, amountKopecks);
    TBankPaymentProviderService.inFlightInitiations_.set(sessionId, { amountKopecks, currencyCode, promise });

    try {
      return await promise;
    } finally {
      TBankPaymentProviderService.inFlightInitiations_.delete(sessionId);
    }
  }

  protected async executeInitiatePayment_(
    sessionId: string,
    input: InitiatePaymentInput,
    amountKopecks: number,
  ): Promise<InitiatePaymentOutput> {
    const existingData = (input.data ?? {}) as TBankSessionData;
    if (input.data && typeof input.data === "object") {
      delete input.data.receiptSnapshot;
      delete input.data.receiptSnapshotSignature;
    }

    if (input.currency_code.toLowerCase() !== "rub") {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `tbank: поддерживается только RUB, получено ${input.currency_code}`,
      );
    }

    // Проверка неизменности корзины (§Task 5): если снапшот уже был сохранён,
    // сессия не может подтвердить изменённую корзину.
    if (existingData.cartSnapshot) {
      if (
        existingData.cartSnapshot.amountKopecks !== amountKopecks ||
        existingData.cartSnapshot.currencyCode !== input.currency_code.toLowerCase()
      ) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          `tbank: сумма или валюта корзины изменилась после инициализации платежа (ожидалось ${existingData.cartSnapshot.amountKopecks} коп. ${existingData.cartSnapshot.currencyCode}, получено ${amountKopecks} коп. ${input.currency_code.toLowerCase()})`,
        );
      }
    }

    // Сверка с существующими попытками в БД (tbank_payment_attempt) до вызова банка:
    let persistedAttemptId: string | undefined;
    if (this.notificationService_?.listTbankPaymentAttempts) {
      try {
        const attempts = await this.notificationService_.listTbankPaymentAttempts({
          order_id: sessionId,
        });
        if (attempts && attempts.length > 0) {
          const existingAttempt = attempts[0];
          persistedAttemptId = existingAttempt.id;
          if (
            existingAttempt.expected_amount_kopecks !== amountKopecks ||
            existingAttempt.currency_code.toLowerCase() !== input.currency_code.toLowerCase() ||
            existingAttempt.terminal_key !== this.options_.terminalKey ||
            existingAttempt.provider_id !== TBANK_PAYMENT_PROVIDER_ID ||
            existingAttempt.payment_session_id !== sessionId
          ) {
            throw new MedusaError(
              MedusaError.Types.INVALID_DATA,
              `tbank: попытка оплаты для сессии ${sessionId} уже была зарегистрирована в БД с другой суммой/валютой (ожидалось ${existingAttempt.expected_amount_kopecks} коп. ${existingAttempt.currency_code}, получено ${amountKopecks} коп. ${input.currency_code.toLowerCase()})`,
            );
          }
        }
      } catch (dbErr) {
        if (dbErr instanceof MedusaError) {
          throw dbErr;
        }
        throw new TBankAttemptPersistenceError(sessionId, dbErr);
      }
    }
    if (persistedAttemptId && !existingData.paymentId) {
      // The first Init may have reached the bank before its response/session
      // data was lost. A durable attempt is not permission for a second Init.
      existingData.status = "indeterminate";
    }

    // Обработка неопределённого состояния (indeterminate) после таймаута:
    // никогда не посылать повторный Init вслепую, а сверить через OrderId/PaymentId.
    if (existingData.status === "indeterminate") {
      existingData.orderId = sessionId;
      existingData.attemptId = persistedAttemptId ?? existingData.attemptId;
      existingData.cartSnapshot ??= {
        amountKopecks,
        currencyCode: "rub",
        orderId: sessionId,
      };
      if (existingData.paymentId) {
        try {
          const state = await this.verifiedBankState_(existingData);
          if (state.Success && state.Status) {
            existingData.status = state.Status;
            return {
              id: existingData.paymentId,
              status: toSessionStatus(state.Status),
              data: existingData as unknown as Record<string, unknown>,
            };
          }
        } catch (stateErr) {
          this.logger_.warn(
            `tbank: повторный initiatePayment для indeterminate сессии ${sessionId}: GetState(${existingData.paymentId}) не ответил: ${
              stateErr instanceof Error ? stateErr.message : String(stateErr)
            }`,
          );
        }
      } else {
        try {
          const orderState = await this.client_.checkOrder(sessionId);
          if (
            orderState.Success &&
            orderState.OrderId === sessionId &&
            Array.isArray(orderState.Payments) &&
            orderState.Payments.length === 1
          ) {
            const paymentId = String(orderState.Payments[0].PaymentId);
            const state = await this.verifiedBankState_({ ...existingData, paymentId });
            existingData.paymentId = paymentId;
            existingData.status = state.Status;
            return {
              id: paymentId,
              status: toSessionStatus(state.Status ?? ""),
              data: existingData as unknown as Record<string, unknown>,
            };
          }
        } catch (checkErr) {
          if (
            checkErr instanceof TBankApiError &&
            checkErr.method === "CheckOrder" &&
            ["914", "407", "63", "335"].includes(checkErr.errorCode)
          ) {
            this.logger_.info(
              `tbank: CheckOrder подтвердил отсутствие заказа ${sessionId} в банке [${checkErr.errorCode}], выполняем повторный Init`,
            );
            existingData.status = undefined;
          } else {
            this.logger_.warn(
              `tbank: CheckOrder для indeterminate сессии ${sessionId} не ответил: ${
                checkErr instanceof Error ? checkErr.message : String(checkErr)
              }`,
            );
          }
        }
      }

      if (existingData.status === "indeterminate") {
        throw new MedusaError(
          MedusaError.Types.CONFLICT,
          `tbank: попытка платежа для сессии ${sessionId} находится в неопределённом состоянии (indeterminate), повторный Init заблокирован до сверки`,
        );
      }
    }

    // Идемпотентный повтор (tab reload / retry / double click):
    // если попытка уже существует и активна, возвращаем её без повторного Init.
    if (
      existingData.paymentId &&
      existingData.paymentUrl &&
      (existingData.orderId === undefined || existingData.orderId === sessionId) &&
      (!existingData.status ||
        existingData.status === "NEW" ||
        existingData.status === "pending_authorization" ||
        existingData.status === "FORM_SHOWED")
    ) {
      // A previously issued bank URL must not be re-exposed after the buyer
      // removes the shipping method from the cart.
      await this.receiptSource_.resolve({
        sessionId,
        existingSnapshotEnvelope: existingData.receiptSnapshotEnvelope,
        paymentAmountKopecks: amountKopecks,
      });
      this.logger_.info(
        `tbank: повторный initiatePayment для сессии ${sessionId} — повторное использование существующей попытки ${existingData.paymentId}`,
      );
      return {
        id: existingData.paymentId,
        status: "pending_authorization",
        data: existingData as unknown as Record<string, unknown>,
      };
    }
    if (existingData.paymentId) {
      if (existingData.orderId !== sessionId) {
        throw new MedusaError(MedusaError.Types.INVALID_DATA, "tbank: банковская попытка относится к другой сессии");
      }
      const state = await this.verifiedBankState_(existingData);
      return {
        id: existingData.paymentId,
        status: toSessionStatus(state.Status ?? ""),
        data: { ...existingData, status: state.Status },
      };
    }

    const attemptId = persistedAttemptId ?? `tbatt_${sessionId}_${Date.now()}`;
    const receiptResolution = await this.receiptSource_.resolve({
      sessionId,
      existingSnapshotEnvelope: existingData.receiptSnapshotEnvelope,
      paymentAmountKopecks: amountKopecks,
    });
    const {
      cartId,
      receipt,
      snapshotEnvelope,
    } = receiptResolution;
    const hold = await this.checkoutHolds_.acquirePaymentHold(sessionId, cartId);
    const expiresAt = new Date(hold.expires_at);
    if (!Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() - Date.now() < 60_000) {
      throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "Срок резерва истекает. Начните оформление заново после завершения банковской попытки");
    }
    const paymentExpiresAt = expiresAt.toISOString().replace(/Z$/, "+00:00");
    existingData.receiptSnapshotEnvelope = snapshotEnvelope;
    if (input.data && typeof input.data === "object") {
      input.data.receiptSnapshotEnvelope = snapshotEnvelope;
    }
    const cartSnapshot: CartSnapshot = {
      cartId,
      amountKopecks,
      currencyCode: input.currency_code.toLowerCase(),
      orderId: sessionId,
    };

    // Персистентность попытки в PostgreSQL перед вызовом банка (§Task 5):
    // если Init упадёт по таймауту или Medusa удалит session при ошибке,
    // факт попытки и её параметры останутся в tbank_payment_attempt.
    if (!persistedAttemptId && this.notificationService_?.createTbankPaymentAttempts) {
      try {
        await this.notificationService_.createTbankPaymentAttempts({
          id: attemptId,
          payment_session_id: sessionId,
          provider_id: TBANK_PAYMENT_PROVIDER_ID,
          terminal_key: this.options_.terminalKey,
          order_id: sessionId,
          expected_amount_kopecks: amountKopecks,
          currency_code: input.currency_code.toLowerCase(),
        });
      } catch (insertErr) {
        throw new TBankAttemptPersistenceError(sessionId, insertErr);
      }
    }

    try {
      const result = await this.client_.init({
        orderId: sessionId,
        amountKopecks,
        successUrl: this.options_.successUrl,
        failUrl: this.options_.failUrl,
        notificationUrl: this.options_.notificationUrl,
        receipt,
        redirectDueDate: paymentExpiresAt,
      });

      if (!result.PaymentId) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          `tbank: ответ Init для сессии ${sessionId} не содержит PaymentId`,
        );
      }

      validatePaymentUrl(result.PaymentURL);
      if (
        (result.OrderId !== undefined && result.OrderId !== sessionId) ||
        (result["TerminalKey"] !== undefined && result["TerminalKey"] !== this.options_.terminalKey)
      ) {
        throw new MedusaError(MedusaError.Types.INVALID_DATA, "tbank: ответ Init относится к другой сессии или терминалу");
      }

      if (result.Amount !== undefined && Number(result.Amount) !== amountKopecks) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          `tbank: сумма ответа Init (${result.Amount}) не совпадает с запрошенной (${amountKopecks})`,
        );
      }

      const data: TBankSessionData = {
        paymentId: String(result.PaymentId),
        paymentUrl: result.PaymentURL,
        orderId: sessionId,
        status: result.Status ?? "NEW",
        attemptId,
        cartSnapshot,
        initiatedAt: new Date().toISOString(),
        receiptSnapshotEnvelope: snapshotEnvelope,
        paymentExpiresAt,
      };

      if (input.data && typeof input.data === "object") {
        Object.assign(input.data, data);
      }

      return {
        id: String(result.PaymentId),
        status: "pending_authorization",
        data: data as unknown as Record<string, unknown>,
      };
    } catch (error) {
      const isIndeterminate =
        (error instanceof TBankApiError &&
          (error.errorCode === "TIMEOUT" || error.errorCode === "NETWORK")) ||
        (error instanceof Error &&
          (error.name === "AbortError" ||
            error.message.toLowerCase().includes("timeout") ||
            error.message.toLowerCase().includes("abort")));

      if (isIndeterminate) {
        if (input.data && typeof input.data === "object") {
          const mutableData = input.data as TBankSessionData;
          mutableData.status = "indeterminate";
          mutableData.orderId = sessionId;
          mutableData.attemptId = attemptId;
          mutableData.cartSnapshot = cartSnapshot;
          mutableData.receiptSnapshotEnvelope = snapshotEnvelope;
          mutableData.indeterminateReason =
            error instanceof Error ? error.message : String(error);
          mutableData.initiatedAt = new Date().toISOString();
        }
        this.logger_.warn(
          `tbank: Init для сессии ${sessionId} завершился неоднозначно (${
            error instanceof TBankApiError ? error.errorCode : "TIMEOUT"
          }): состояние сессии помечено как indeterminate`,
        );
        throw new MedusaError(
          MedusaError.Types.PAYMENT_AUTHORIZATION_ERROR,
          `tbank: Init таймаут/сетевой сбой для сессии ${sessionId}, состояние неопределено (indeterminate)`,
        );
      }

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

    const result = await this.verifiedBankState_(data);
    return {
      status: toSessionStatus(result.Status ?? ""),
      data: {
        ...data,
        status: result.Status,
        Amount: result.Amount,
      } as unknown as Record<string, unknown>,
    };
  }

  /**
   * Only /hooks/payment/tbank may ingest bank callbacks: it authenticates,
   * correlates and durably records the notification before reconciliation.
   * Medusa also exposes generic provider aliases; projecting them here would
   * bypass the inbox and let a signed but unrelated payment complete a cart.
   */
  async getWebhookActionAndData(
    _payload: ProviderWebhookPayload["payload"],
  ): Promise<WebhookActionResult> {
    return { action: "not_supported" };
  }

  /**
   * PayType O requires no bank capture operation. A manual Medusa capture must
   * still prove CONFIRMED: AUTHORIZED is only a hold, not money received.
   */
  async capturePayment(input: CapturePaymentInput): Promise<CapturePaymentOutput> {
    const data = (input.data ?? {}) as TBankSessionData;
    const state = await this.verifiedBankState_(data);
    if (state.Status !== "CONFIRMED") {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        "tbank: списание в Medusa допускается только после GetState=CONFIRMED",
      );
    }
    if (data.orderId) await this.checkoutHolds_.settlePaymentHold(data.orderId);
    return { data: { ...data, status: state.Status } };
  }

  /**
   * Authorize only from a correlated live bank state. A stale/client-supplied
   * data.status is never evidence of capture when the bank is unavailable.
   */
  async authorizePayment(input: AuthorizePaymentInput): Promise<AuthorizePaymentOutput> {
    const data = (input.data ?? {}) as TBankSessionData;

    // Платежа в банке нет — спрашивать не о чем, и это не ошибка: сессия просто
    // не дошла до `Init`. Прежнее поведение сохранено осознанно.
    if (!data.paymentId) {
      return { status: "pending_authorization", data: input.data };
    }
    if (input.context?.idempotency_key && input.context.idempotency_key !== data.orderId) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "tbank: OrderId не совпадает с платёжной сессией");
    }

    try {
      const result = await this.getPaymentStatus(input);
      return { status: result.status, data: result.data };
    } catch (error) {
      if (error instanceof MedusaError && error.type === MedusaError.Types.INVALID_DATA) {
        throw error;
      }
      this.logger_.warn(
        `tbank: GetState при авторизации платежа ${data.paymentId} не прошёл (${
          error instanceof Error ? error.message : String(error)
        }), подтверждение оплаты отложено`,
      );
      return { status: "pending_authorization", data: input.data };
    }
  }

  /**
   * Cancel у банка может стать возвратом даже после GetState=NEW: состояние
   * меняется между запросами. До реализации возвратного чека здесь только
   * чтение состояния; активный банковский платёж отменяется вручную.
   */
  async cancelPayment(input: CancelPaymentInput): Promise<CancelPaymentOutput> {
    const data = (input.data ?? {}) as TBankSessionData;
    if (!data.paymentId) {
      // Платёж не создавался — отменять нечего, и это не ошибка.
      return { data: input.data };
    }
    // Безопасно удалить только уже завершённую неоплачиваемую попытку.
    const state = await this.verifiedBankState_(data);
    if (
      state.Status === "CANCELED" ||
      state.Status === "REVERSED" ||
      state.Status === "REJECTED" ||
      state.Status === "DEADLINE_EXPIRED"
    ) {
      if (data.orderId) await this.checkoutHolds_.releasePaymentHold(data.orderId);
      return { data: input.data };
    }
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      "tbank: автоматическая отмена активного банковского платежа недоступна; обратитесь к ответственному за ККТ для ручной отмены или возврата с фискализацией",
    );
  }

  /**
   * Возврат.
   *
   * ВНИМАНИЕ. Возврат по 54-ФЗ требует **возвратного чека** — `Cancel` с
   * `Receipt` (§8). Построение возвратного чека здесь не реализовано: текущий
   * builder создаёт только чек 100% предоплаты для `Init`. Метод блокирует
   * возврат до обращения в банк; ручной возврат требует отдельного чека ККТ.
   */
  async refundPayment(input: RefundPaymentInput): Promise<RefundPaymentOutput> {
    const data = (input.data ?? {}) as TBankSessionData;
    if (!data.paymentId) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "tbank: возврат невозможен — в сессии нет PaymentId",
      );
    }

    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      "tbank: автоматический возврат недоступен без возвратного чека; обратитесь к ответственному за ККТ для ручного возврата и фискализации",
    );
  }

  async retrievePayment(input: RetrievePaymentInput): Promise<RetrievePaymentOutput> {
    const data = (input.data ?? {}) as TBankSessionData;
    if (!data.paymentId) {
      return { data: input.data };
    }
    const result = await this.verifiedBankState_(data);
    return {
      data: { ...data, status: result.Status } as unknown as Record<string, unknown>,
    };
  }

  /**
   * The bank amount cannot be updated after Init. Reject a changed Medusa
   * amount/currency instead of retaining a bank payment for an older cart.
   */
  async updatePayment(input: UpdatePaymentInput): Promise<UpdatePaymentOutput> {
    const data = (input.data ?? {}) as TBankSessionData;
    if (data.paymentId || data.cartSnapshot) {
      if (
        !data.cartSnapshot ||
        data.cartSnapshot.amountKopecks !== rublesToKopecks(input.amount) ||
        data.cartSnapshot.currencyCode !== input.currency_code.toLowerCase()
      ) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          "tbank: сумма или валюта изменились после Init; сначала завершите прежнюю банковскую попытку",
        );
      }
    }
    return { data: input.data };
  }

  /** Удаление сессии допускается только без платежа или после его завершения. */
  async deletePayment(input: DeletePaymentInput): Promise<DeletePaymentOutput> {
    await this.cancelPayment(input);
    return { data: input.data };
  }

  private async verifiedBankState_(data: TBankSessionData): Promise<TBankGetStateResult> {
    const snapshot = data.cartSnapshot;
    if (
      !data.paymentId || !data.orderId || !snapshot ||
      snapshot.orderId !== data.orderId || snapshot.currencyCode !== "rub" ||
      !Number.isSafeInteger(snapshot.amountKopecks) || snapshot.amountKopecks <= 0
    ) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "tbank: отсутствует достоверный снимок банковской попытки");
    }
    const state = await this.client_.getState(data.paymentId);
    const trust = validateBankState(state, {
      payment_id: data.paymentId,
      order_id: data.orderId,
      amount_kopecks: snapshot.amountKopecks,
    }, this.options_.terminalKey, true);
    if (!trust.valid) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, `tbank: ${trust.reason}`);
    }
    // Refunds require separate fiscal/accounting recovery, never a fresh capture.
    if (state.Status === "REFUNDED" || state.Status === "PARTIAL_REFUNDED") {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "tbank: возврат банка требует ручной сверки платежа и ККТ");
    }
    return state;
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
