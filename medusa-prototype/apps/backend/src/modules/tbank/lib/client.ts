/**
 * HTTP-клиент Т-Банка.
 *
 * Тонкий слой: подпись, таймаут, разбор конверта ответа. Никакой бизнес-логики
 * — она в провайдере и в чистых функциях рядом. Всё, что здесь есть,
 * существует потому, что API банка устроено не так, как ожидает наивный
 * вызывающий код.
 *
 * Главная особенность: **HTTP 200 не означает успех**. Банк отвечает 200 почти
 * всегда, а исход операции лежит в поле `Success` тела, при этом `ErrorCode`
 * приходит строкой, и `"0"` — это успех. Проверять надо тело, а не статус.
 */

import { generateToken } from "./token";
import type { TBankReceipt } from "./receipt";
import type { TBankFiscalReceipt } from "./refund-receipt";

export type TBankCredentials = {
  terminalKey: string;
  password: string;
  /** Базовый URL API. Тестовый и боевой терминалы различаются только им. */
  apiBaseUrl: string;
};

/** Общий конверт ответа Т-Банка. */
export type TBankResponse = {
  Success: boolean;
  ErrorCode: string;
  Message?: string;
  Details?: string;
  [key: string]: unknown;
};

export type TBankInitResult = TBankResponse & {
  PaymentId?: string;
  PaymentURL?: string;
  Status?: string;
  Amount?: number;
  OrderId?: string;
};

export type TBankGetStateResult = TBankResponse & {
  PaymentId?: string;
  Status?: string;
  Amount?: number;
  OrderId?: string;
};

export type TBankCheckOrderPayment = {
  PaymentId: string | number;
  Amount?: number;
  Status?: string;
  Rrn?: string;
  Success?: boolean;
  ErrorCode?: string;
  Message?: string;
};

export type TBankCheckOrderResult = TBankResponse & {
  OrderId?: string;
  Status?: string;
  Payments?: TBankCheckOrderPayment[];
};

/** Cancel amounts are the balance BEFORE and AFTER this operation, not its refund amount. */
export type TBankCancelResult = TBankResponse & {
  Success: true;
  TerminalKey: string;
  PaymentId: string;
  Status: string;
  OrderId: string;
  OriginalAmount: number;
  NewAmount: number;
  ExternalRequestId?: string;
};

// SendClosingReceipt documents no response correlation/idempotency fields.
// Its HTTP acknowledgement is NOT evidence of successful fiscalization.
export type TBankClosingReceiptResult = TBankResponse;

/**
 * Ошибка вызова Т-Банка. Отдельный класс, потому что `ErrorCode` нужен
 * вызывающему коду: по нему различаются «отказ банка» (обрабатываем как
 * неуспешный платёж) и «мы отправили ерунду» (это баг, его надо видеть).
 */
export class TBankApiError extends Error {
  readonly errorCode: string;
  readonly details?: string;
  readonly method: string;

  constructor(method: string, errorCode: string, message: string, details?: string) {
    super(`TBank ${method} failed [${errorCode}]: ${message}`);
    this.name = "TBankApiError";
    this.method = method;
    this.errorCode = errorCode;
    this.details = details;
  }
}

const DEFAULT_TIMEOUT_MS = 15_000;

export class TBankClient {
  private readonly credentials: TBankCredentials;
  private readonly timeoutMs: number;

  constructor(credentials: TBankCredentials, timeoutMs: number = DEFAULT_TIMEOUT_MS) {
    this.credentials = credentials;
    this.timeoutMs = timeoutMs;
  }

  /**
   * Вызов метода API.
   *
   * `TerminalKey` и `Token` добавляются здесь, чтобы вызывающий код физически
   * не мог их забыть или подписать не то. Подпись считается по полям запроса
   * после добавления `TerminalKey` — вложенные объекты (`Receipt`, `DATA`) в
   * неё не входят, это обеспечивает `generateToken`.
   */
  async call<T extends TBankResponse>(
    method: string,
    params: Record<string, unknown>,
  ): Promise<T> {
    let requestUrl = `${this.credentials.apiBaseUrl}/${method}`;
    if (method === "SendClosingReceipt") {
      // Only this production cashbox endpoint is documented. Never send test
      // credentials to production or derive a new origin from caller input.
      if (this.credentials.apiBaseUrl !== "https://securepay.tinkoff.ru/v2") {
        throw new TBankApiError(method, "API_BASE_URL", "Closing receipt endpoint is not approved for this API origin");
      }
      requestUrl = "https://securepay.tinkoff.ru/cashbox/SendClosingReceipt";
    }
    const body: Record<string, unknown> = {
      TerminalKey: this.credentials.terminalKey,
      ...params,
    };
    if (params.Receipt) {
      // The cashbox uses FFD 1.2. Add its wire metadata without changing the
      // authenticated receipt snapshot, including historical envelopes.
      body.Receipt = {
        ...(params.Receipt as TBankReceipt | TBankFiscalReceipt),
        FfdVersion: "1.2",
      };
    }
    body.Token = generateToken(body, this.credentials.password);

    // Таймаут обязателен: без него подвисший банк держит воркер до бесконечности.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;
    try {
      response = await fetch(requestUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
        redirect: "error",
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new TBankApiError(
          method,
          "TIMEOUT",
          `Т-Банк не ответил за ${this.timeoutMs} мс`,
        );
      }
      throw new TBankApiError(
        method,
        "NETWORK",
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      clearTimeout(timer);
    }

    // Транспортная ошибка — единственный случай, когда статус что-то значит.
    if (!response.ok) {
      throw new TBankApiError(
        method,
        `HTTP_${response.status}`,
        `Т-Банк ответил ${response.status}`,
      );
    }

    let payload: T;
    try {
      payload = (await response.json()) as T;
    } catch {
      throw new TBankApiError(method, "BAD_JSON", "Ответ Т-Банка не разбирается как JSON");
    }

    // Исход операции — в теле, а не в статусе.
    if (payload.Success !== true) {
      throw new TBankApiError(
        method,
        typeof payload.ErrorCode === "string" ? payload.ErrorCode : "UNKNOWN",
        payload.Message ?? "без сообщения",
        payload.Details,
      );
    }

    return payload;
  }

  /**
   * Создание платежа. `receipt` передаётся отдельным параметром, чтобы было
   * видно: он не приходит от клиента, а собирается на сервере (§6.1).
   *
   * Если к терминалу подключена онлайн-касса, `Init` без валидного `Receipt`
   * не проходит: вызывающий провайдер обязан собрать его из серверной корзины.
   */
  async init(params: {
    orderId: string;
    amountKopecks: number;
    description?: string;
    successUrl?: string;
    failUrl?: string;
    notificationUrl?: string;
    redirectDueDate?: string;
    receipt?: TBankReceipt;
    data?: Record<string, string>;
  }): Promise<TBankInitResult> {
    return this.call<TBankInitResult>("Init", {
      Amount: params.amountKopecks,
      OrderId: params.orderId,
      // One-stage acquiring: only CONFIRMED, not AUTHORIZED, proves capture.
      PayType: "O",
      ...(params.description ? { Description: params.description } : {}),
      ...(params.successUrl ? { SuccessURL: params.successUrl } : {}),
      ...(params.failUrl ? { FailURL: params.failUrl } : {}),
      ...(params.notificationUrl ? { NotificationURL: params.notificationUrl } : {}),
      ...(params.redirectDueDate ? { RedirectDueDate: params.redirectDueDate } : {}),
      ...(params.receipt ? { Receipt: params.receipt } : {}),
      ...(params.data ? { DATA: params.data } : {}),
    });
  }

  /** Текущее состояние платежа. Основа reconciliation-джобы (PAY-005). */
  async getState(paymentId: string): Promise<TBankGetStateResult> {
    return this.call<TBankGetStateResult>("GetState", { PaymentId: paymentId });
  }

  /**
   * Проверка заказа по OrderId.
   *
   * Используется для устранения неопределённости (indeterminate), когда `Init`
   * завершился сетевым таймаутом до получения `PaymentId`.
   */
  async checkOrder(orderId: string): Promise<TBankCheckOrderResult> {
    return this.call<TBankCheckOrderResult>("CheckOrder", { OrderId: orderId });
  }

  /**
   * Full refunds omit Receipt; partial refunds supply exact fiscal positions.
   * Persist both identifiers before submission and reuse them verbatim on replay.
   * ExternalRequestId: <=255; installments <=100; AlfaPay <=30; BNPL UUIDv4.
   * A deterministic 30-character SHA-256 prefix suits cards/SBP/T-Pay/AlfaPay.
   * BNPL instead needs a persisted UUIDv4 and explicit payment-method support.
   */
  async cancel(params: {
    paymentId: string;
    externalRequestId: string;
    merchRefundId: string;
    amountKopecks?: number;
    receipt?: TBankFiscalReceipt;
  }): Promise<TBankCancelResult> {
    if (typeof params.externalRequestId !== "string" || !params.externalRequestId.trim() ||
        params.externalRequestId.length > 255 || typeof params.merchRefundId !== "string" ||
        !params.merchRefundId.trim() || params.merchRefundId.length > 100) {
      throw new TBankApiError("Cancel", "INVALID_REQUEST", "Stable refund identifiers are required");
    }
    if (params.amountKopecks !== undefined &&
        (!Number.isSafeInteger(params.amountKopecks) || params.amountKopecks <= 0)) {
      throw new TBankApiError("Cancel", "INVALID_REQUEST", "Refund amount must be positive integer kopecks");
    }
    if (params.receipt && (params.amountKopecks === undefined || params.receipt.Items.length === 0 ||
        params.receipt.Items.length > 100 ||
        params.receipt.Items.reduce((sum, item) => sum + item.Amount, 0) !== params.amountKopecks)) {
      throw new TBankApiError("Cancel", "INVALID_REQUEST", "Partial refund receipt must match its amount");
    }
    const result = await this.call<TBankCancelResult>("Cancel", {
      PaymentId: params.paymentId,
      ExternalRequestId: params.externalRequestId,
      DATA: { MerchRefundId: params.merchRefundId },
      ...(params.amountKopecks !== undefined ? { Amount: params.amountKopecks } : {}),
      ...(params.receipt ? { Receipt: params.receipt } : {}),
    });
    if (result.ErrorCode !== "0" || result.PaymentId !== params.paymentId || result.TerminalKey !== this.credentials.terminalKey ||
        typeof result.Status !== "string" || !result.Status || typeof result.OrderId !== "string" ||
        !Number.isSafeInteger(result.OriginalAmount) || !Number.isSafeInteger(result.NewAmount) ||
        result.NewAmount < 0 || result.OriginalAmount < result.NewAmount ||
        (result.ExternalRequestId !== undefined && result.ExternalRequestId !== params.externalRequestId)) {
      // Money may already have moved. The coordinator must treat this as unknown,
      // never issue another operation with a different identifier.
      throw new TBankApiError("Cancel", "BAD_RESPONSE", "Refund response cannot be correlated");
    }
    return result;
  }

  /**
   * No ExternalRequestId/MerchRefundId exists in this method's documented schema.
   * Persist a once-only operation before calling; reconcile unknown results through
   * authenticated fiscal notifications rather than blindly resubmitting.
   */
  async sendClosingReceipt(params: {
    paymentId: string;
    receipt: TBankFiscalReceipt;
  }): Promise<TBankClosingReceiptResult> {
    return this.call<TBankClosingReceiptResult>("SendClosingReceipt", {
      PaymentId: params.paymentId,
      Receipt: params.receipt,
    });
  }
}
