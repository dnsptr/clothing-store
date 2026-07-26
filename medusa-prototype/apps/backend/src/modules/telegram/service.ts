/**
 * Провайдер уведомлений в Telegram.
 *
 * Выбран первым каналом по двум причинам. Заказчик просил именно его для
 * менеджеров и логистов, и он не требует ни новых зависимостей (обычный HTTP
 * через глобальный fetch), ни выбора почтового хостинга, который пока не
 * сделан. Почтовый канал добавляется рядом отдельным провайдером, когда будет
 * решено, через что отправлять письма из РФ.
 */

import { AbstractNotificationProviderService, MedusaError } from "@medusajs/framework/utils";
import type { Logger } from "@medusajs/framework/types";
import type { NotificationTypes } from "@medusajs/types";

export type TelegramOptions = {
  botToken: string;
  /** Чат по умолчанию, если получатель не указан явно. */
  defaultChatId?: string;
  apiBaseUrl?: string;
  timeoutMs?: number;
};

type InjectedDependencies = {
  logger: Logger;
};

const DEFAULT_API_BASE_URL = "https://api.telegram.org";
const DEFAULT_TIMEOUT_MS = 10_000;

/** Лимит длины сообщения Telegram. Всё, что длиннее, отвергается целиком. */
const TELEGRAM_MESSAGE_LIMIT = 4096;

export class TelegramNotificationProviderService extends AbstractNotificationProviderService {
  static identifier = "telegram";

  protected readonly logger_: Logger;
  protected readonly options_: TelegramOptions;

  static validateOptions(options: Record<string, unknown>): void {
    if (!options.botToken || typeof options.botToken !== "string") {
      throw new MedusaError(
        MedusaError.Types.INVALID_ARGUMENT,
        "telegram: требуется botToken (TELEGRAM_BOT_TOKEN)",
      );
    }
  }

  constructor(container: InjectedDependencies, options: TelegramOptions) {
    super();
    this.logger_ = container.logger;
    this.options_ = options;
  }

  async send(
    notification: NotificationTypes.ProviderSendNotificationDTO,
  ): Promise<NotificationTypes.ProviderSendNotificationResultsDTO> {
    const chatId = notification.to?.trim() || this.options_.defaultChatId?.trim();
    if (!chatId) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "telegram: не указан получатель и не задан TELEGRAM_CHAT_ID",
      );
    }

    const text = this.resolveText_(notification);
    if (!text) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "telegram: пустой текст уведомления",
      );
    }

    const base = this.options_.apiBaseUrl ?? DEFAULT_API_BASE_URL;
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      this.options_.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    );

    try {
      const response = await fetch(`${base}/bot${this.options_.botToken}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          // parse_mode не задаётся намеренно: в разметке пришлось бы
          // экранировать имена и адреса покупателей, и первая же фамилия с
          // подчёркиванием ломала бы отправку.
          text: truncateForTelegram(text),
          disable_web_page_preview: true,
        }),
        signal: controller.signal,
      });

      const payload = (await response.json().catch(() => null)) as
        | { ok?: boolean; description?: string; result?: { message_id?: number } }
        | null;

      // Telegram отвечает 200 не всегда, но и на ошибку может ответить 200 с
      // ok: false — проверяем тело, а не только статус.
      if (!response.ok || payload?.ok !== true) {
        throw new MedusaError(
          MedusaError.Types.UNEXPECTED_STATE,
          `telegram: отправка не прошла (${response.status}): ${
            payload?.description ?? "без описания"
          }`,
        );
      }

      return { id: payload.result?.message_id ? String(payload.result.message_id) : undefined };
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new MedusaError(
          MedusaError.Types.UNEXPECTED_STATE,
          `telegram: нет ответа за ${this.options_.timeoutMs ?? DEFAULT_TIMEOUT_MS} мс`,
        );
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Текст берётся из `content.text`, затем из `data.text`. Шаблоны на стороне
   * Telegram не поддерживаются, поэтому сообщение формируется вызывающим кодом
   * (`src/lib/order-message.ts`).
   */
  private resolveText_(
    notification: NotificationTypes.ProviderSendNotificationDTO,
  ): string | undefined {
    const fromContent = notification.content?.text;
    if (typeof fromContent === "string" && fromContent.trim()) {
      return fromContent;
    }
    const fromData = notification.data?.text;
    if (typeof fromData === "string" && fromData.trim()) {
      return fromData;
    }
    return undefined;
  }
}

/**
 * Обрезка под лимит Telegram.
 *
 * Сообщение длиннее 4096 символов отвергается целиком, поэтому лучше доставить
 * усечённое уведомление о заказе, чем не доставить никакого: заказ с большим
 * числом позиций — не повод оставить менеджера без оповещения.
 */
export function truncateForTelegram(text: string): string {
  const points = Array.from(text);
  if (points.length <= TELEGRAM_MESSAGE_LIMIT) {
    return text;
  }
  const suffix = "\n…сообщение усечено";
  const budget = TELEGRAM_MESSAGE_LIMIT - Array.from(suffix).length;
  return points.slice(0, budget).join("") + suffix;
}

export default TelegramNotificationProviderService;
