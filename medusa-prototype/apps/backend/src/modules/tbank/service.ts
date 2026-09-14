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
import {
  TBANK_PAYMENT_PROVIDER_ID,
  TBANK_PROVIDER_IDENTIFIER,
} from "./provider-id";

export type TBankOptions = {
  terminalKey: string;
  password: string;
  apiBaseUrl?: string;
  successUrl?: string;
  failUrl?: string;
  notificationUrl?: string;
  timeoutMs?: number;
};

import { TBANK_NOTIFICATION_MODULE } from "../tbank-notifications";
import type {
  TbankNotificationStore,
  TbankPaymentAttemptRow,
} from "../tbank-notifications/lifecycle";

export type InjectedDependencies = {
  logger: Logger;
  [TBANK_NOTIFICATION_MODULE]?: TbankNotificationStore;
  [key: string]: unknown;
};

const DEFAULT_API_BASE_URL = "https://securepay.tinkoff.ru/v2";

export const APPROVED_PAYMENT_URL_HOSTNAMES = new Set([
  "securepay.tinkoff.ru",
  "rest-api-test.tinkoff.ru",
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
}

export type CartSnapshot = {
  cartId?: string;
  version?: number | string;
  amountKopecks: number;
  currencyCode: string;
  orderId: string;
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
  indeterminateReason?: string;
};

export class TBankPaymentProviderService extends AbstractPaymentProvider<TBankOptions> {
  static identifier = TBANK_PROVIDER_IDENTIFIER;

  protected readonly logger_: Logger;
  protected readonly options_: TBankOptions;
  protected readonly client_: TBankClient;
  protected readonly notificationService_?: TbankNotificationStore;
  private static readonly inFlightInitiations_ = new Map<string, Promise<InitiatePaymentOutput>>();

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
    this.notificationService_ =
      (container[TBANK_NOTIFICATION_MODULE] as TbankNotificationStore | undefined) ??
      (typeof (container as unknown as { resolve?: (key: string, opts?: unknown) => unknown }).resolve === "function"
        ? ((container as unknown as { resolve: (key: string, opts?: unknown) => unknown }).resolve(
            TBANK_NOTIFICATION_MODULE,
            { allowUnregistered: true },
          ) as TbankNotificationStore | undefined)
        : undefined);
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
    const inFlight = TBankPaymentProviderService.inFlightInitiations_.get(sessionId);
    if (inFlight) {
      this.logger_.info(
        `tbank: параллельный вызов initiatePayment для сессии ${sessionId} обнаружен, ожидаем завершения первого запроса`,
      );
      return inFlight;
    }

    const promise = this.executeInitiatePayment_(sessionId, input);
    TBankPaymentProviderService.inFlightInitiations_.set(sessionId, promise);

    try {
      return await promise;
    } finally {
      TBankPaymentProviderService.inFlightInitiations_.delete(sessionId);
    }
  }

  protected async executeInitiatePayment_(
    sessionId: string,
    input: InitiatePaymentInput,
  ): Promise<InitiatePaymentOutput> {
    const amountKopecks = rublesToKopecks(input.amount);
    const existingData = (input.data ?? {}) as TBankSessionData;

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
      const incomingVersion =
        (input.context?.cart_version as number | string | undefined) ??
        (input.context?.version as number | string | undefined);
      if (
        incomingVersion !== undefined &&
        existingData.cartSnapshot.version !== undefined &&
        String(incomingVersion) !== String(existingData.cartSnapshot.version)
      ) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          `tbank: версия корзины изменилась после инициализации платежа (ожидалось ${existingData.cartSnapshot.version}, получено ${incomingVersion})`,
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
            existingAttempt.currency_code.toLowerCase() !== input.currency_code.toLowerCase()
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
        this.logger_.warn(
          `tbank: ошибка при проверке существующих попыток в БД для сессии ${sessionId}: ${
            dbErr instanceof Error ? dbErr.message : String(dbErr)
          }`,
        );
      }
    }

    // Обработка неопределённого состояния (indeterminate) после таймаута:
    // никогда не посылать повторный Init вслепую, а сверить через OrderId/PaymentId.
    if (existingData.status === "indeterminate") {
      if (existingData.paymentId) {
        try {
          const state = await this.client_.getState(existingData.paymentId);
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
            Array.isArray(orderState.Payments) &&
            orderState.Payments.length > 0
          ) {
            const payment = orderState.Payments[0];
            const paymentId = String(payment.PaymentId);
            existingData.paymentId = paymentId;
            existingData.status = payment.Status ?? orderState.Status ?? "NEW";
            return {
              id: paymentId,
              status: toSessionStatus(existingData.status),
              data: existingData as unknown as Record<string, unknown>,
            };
          }
        } catch (checkErr) {
          if (
            checkErr instanceof TBankApiError &&
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
      this.logger_.info(
        `tbank: повторный initiatePayment для сессии ${sessionId} — повторное использование существующей попытки ${existingData.paymentId}`,
      );
      return {
        id: existingData.paymentId,
        status: "pending_authorization",
        data: existingData as unknown as Record<string, unknown>,
      };
    }

    const attemptId = persistedAttemptId ?? `tbatt_${sessionId}_${Date.now()}`;
    const cartSnapshot: CartSnapshot = {
      cartId:
        (input.context?.cart_id as string | undefined) ??
        (input.context?.cartId as string | undefined),
      version:
        (input.context?.cart_version as number | string | undefined) ??
        (input.context?.version as number | string | undefined),
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
        this.logger_.warn(
          `tbank: не удалось сохранить попытку в tbank_payment_attempt перед Init для сессии ${sessionId}: ${
            insertErr instanceof Error ? insertErr.message : String(insertErr)
          }`,
        );
      }
    }

    try {
      const result = await this.client_.init({
        orderId: sessionId,
        amountKopecks,
        successUrl: this.options_.successUrl,
        failUrl: this.options_.failUrl,
        notificationUrl: this.options_.notificationUrl,
      });

      if (!result.PaymentId) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          `tbank: ответ Init для сессии ${sessionId} не содержит PaymentId`,
        );
      }

      validatePaymentUrl(result.PaymentURL);

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

    const result = await this.client_.getState(data.paymentId);
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
      const bankData = (result.data ?? {}) as Record<string, unknown>;
      if (
        data.cartSnapshot?.amountKopecks !== undefined &&
        bankData.Amount !== undefined &&
        Number(bankData.Amount) !== data.cartSnapshot.amountKopecks
      ) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          `tbank: сумма подтверждения банка (${bankData.Amount}) не совпадает со снапшотом корзины (${data.cartSnapshot.amountKopecks})`,
        );
      }
      return { status: result.status, data: result.data };
    } catch (error) {
      if (error instanceof MedusaError && error.type === MedusaError.Types.INVALID_DATA) {
        throw error;
      }
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
      if (!(error instanceof TBankApiError)) {
        throw error;
      }

      // `Cancel` не идемпотентен по контракту. После ошибки удалять сессию
      // можно только если GetState доказывает, что старый URL уже не оплатить.
      try {
        const state = await this.client_.getState(data.paymentId);
        if (
          state.Status === "CANCELED" ||
          state.Status === "REVERSED" ||
          state.Status === "REJECTED" ||
          state.Status === "DEADLINE_EXPIRED"
        ) {
          this.logger_.warn(
            `tbank: Cancel вернул ${error.errorCode}, но GetState подтвердил ${state.Status}`,
          );
          return { data: input.data };
        }
      } catch (stateError) {
        this.logger_.warn(
          `tbank: после ошибки Cancel не удалось проверить GetState: ${
            stateError instanceof Error ? stateError.message : String(stateError)
          }`,
        );
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
