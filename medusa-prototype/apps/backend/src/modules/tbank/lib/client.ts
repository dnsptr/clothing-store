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
    const body: Record<string, unknown> = {
      TerminalKey: this.credentials.terminalKey,
      ...params,
    };
    body.Token = generateToken(body, this.credentials.password);

    // Таймаут обязателен: без него подвисший банк держит воркер до бесконечности.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;
    try {
      response = await fetch(`${this.credentials.apiBaseUrl}/${method}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
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
   * ВНИМАНИЕ. Если к терминалу подключена онлайн-касса, `Init` **без валидного
   * `Receipt` не проходит вовсе** — банк отвергает запрос. Пока `buildReceipt`
   * не реализован (шаг 3 в §12.2), сквозная оплата возможна только на
   * терминале без кассы.
   */
  async init(params: {
    orderId: string;
    amountKopecks: number;
    description?: string;
    successUrl?: string;
    failUrl?: string;
    notificationUrl?: string;
    receipt?: Record<string, unknown>;
    data?: Record<string, string>;
  }): Promise<TBankInitResult> {
    return this.call<TBankInitResult>("Init", {
      Amount: params.amountKopecks,
      OrderId: params.orderId,
      // Одностадийная оплата (§3): резерв ставится в Medusa до оплаты, второй
      // стадии нечего проверять.
      PayType: "O",
      ...(params.description ? { Description: params.description } : {}),
      ...(params.successUrl ? { SuccessURL: params.successUrl } : {}),
      ...(params.failUrl ? { FailURL: params.failUrl } : {}),
      ...(params.notificationUrl ? { NotificationURL: params.notificationUrl } : {}),
      ...(params.receipt ? { Receipt: params.receipt } : {}),
      ...(params.data ? { DATA: params.data } : {}),
    });
  }

  /** Текущее состояние платежа. Основа reconciliation-джобы (PAY-005). */
  async getState(paymentId: string): Promise<TBankGetStateResult> {
    return this.call<TBankGetStateResult>("GetState", { PaymentId: paymentId });
  }

  /**
   * Отмена или возврат. У Т-Банка это один метод: до списания он отменяет,
   * после — возвращает. Сумма опциональна; без неё возврат полный.
   */
  async cancel(params: {
    paymentId: string;
    amountKopecks?: number;
    receipt?: Record<string, unknown>;
  }): Promise<TBankResponse> {
    return this.call<TBankResponse>("Cancel", {
      PaymentId: params.paymentId,
      ...(params.amountKopecks !== undefined ? { Amount: params.amountKopecks } : {}),
      ...(params.receipt ? { Receipt: params.receipt } : {}),
    });
  }
}
