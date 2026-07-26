/**
 * Провайдер уведомлений по почте (SMTP).
 *
 * Второй канал после Telegram: сотрудникам — сообщение в чат, покупателю —
 * письмо. SMTP выбран потому, что это единственный транспорт, который есть у
 * любого почтового хостинга в РФ (Unisender, Mail.ru, Яндекс, свой relay).
 * Провайдерские SDK (Resend, SendGrid) сюда не годятся — они из России не
 * работают, а привязка к одному API стоила бы переписывания при смене
 * хостинга. Меняется только содержимое `.env`.
 *
 * Шаблонов у провайдера нет: тему, текст и HTML собирает вызывающий код
 * (`src/lib/order-email.ts`) и передаёт в `content`. Так письмо можно
 * проверить тестом без SMTP, а провайдер остаётся тонким транспортом.
 */

import { AbstractNotificationProviderService, MedusaError } from "@medusajs/framework/utils";
import type { Logger } from "@medusajs/framework/types";
import type { NotificationTypes } from "@medusajs/types";
import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";

export type EmailSmtpOptions = {
  host: string;
  port?: number;
  /** Неявный TLS (порт 465). По умолчанию выводится из порта. */
  secure?: boolean;
  user: string;
  password: string;
  /** Отправитель по умолчанию: `Mario Mikke <shop@example.ru>`. */
  from: string;
  timeoutMs?: number;
};

type InjectedDependencies = {
  logger: Logger;
};

const DEFAULT_PORT = 587;
const DEFAULT_TIMEOUT_MS = 15_000;
/** Порт неявного TLS: на нём соединение шифруется до приветствия сервера. */
const IMPLICIT_TLS_PORT = 465;

const REQUIRED_OPTIONS = ["host", "user", "password", "from"] as const;

export class EmailSmtpNotificationProviderService extends AbstractNotificationProviderService {
  static identifier = "email-smtp";

  protected readonly logger_: Logger;
  protected readonly options_: EmailSmtpOptions;
  protected readonly transporter_: Transporter;

  static validateOptions(options: Record<string, unknown>): void {
    for (const key of REQUIRED_OPTIONS) {
      const value = options[key];
      if (!value || typeof value !== "string") {
        throw new MedusaError(
          MedusaError.Types.INVALID_ARGUMENT,
          `email-smtp: требуется ${key} (SMTP_${key.toUpperCase()})`,
        );
      }
    }
  }

  constructor(container: InjectedDependencies, options: EmailSmtpOptions) {
    super();
    this.logger_ = container.logger;
    this.options_ = options;

    const port = options.port ?? DEFAULT_PORT;
    const timeout = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    // Транспорт создаётся один раз: `createTransport` соединение не открывает,
    // оно поднимается на каждом `sendMail`.
    this.transporter_ = nodemailer.createTransport({
      host: options.host,
      port,
      // 465 — неявный TLS, 587 — STARTTLS. Если хостинг не назвал режим явно,
      // выводим его из порта: перепутанные значения дают не ошибку конфигурации,
      // а зависшее соединение, которое потом ищут часами.
      secure: options.secure ?? port === IMPLICIT_TLS_PORT,
      // Без неявного TLS требуем STARTTLS. Иначе nodemailer молча отправит
      // логин и пароль почтового ящика открытым текстом, если сервер не
      // предложит шифрование.
      requireTLS: !(options.secure ?? port === IMPLICIT_TLS_PORT),
      auth: { user: options.user, pass: options.password },
      // Таймауты обязательны: без них зависший SMTP держит воркер событий, и
      // очередь уведомлений встаёт целиком.
      connectionTimeout: timeout,
      greetingTimeout: timeout,
      socketTimeout: timeout,
    });
  }

  async send(
    notification: NotificationTypes.ProviderSendNotificationDTO,
  ): Promise<NotificationTypes.ProviderSendNotificationResultsDTO> {
    const to = notification.to?.trim();
    if (!to) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "email-smtp: не указан адрес получателя",
      );
    }

    const text = notification.content?.text?.trim() ? notification.content.text : undefined;
    const html = notification.content?.html?.trim() ? notification.content.html : undefined;

    if (!text && !html) {
      // Пустое письмо не отправляем, но и не бросаем. В канал `email` пишет не
      // только наш подписчик: штатный `configurable-notifications` Medusa на
      // каждый `order.created` создаёт уведомление без `content` — с ошибкой
      // журнал уведомлений краснел бы на каждом заказе, а покупатель всё равно
      // получил бы пустой конверт.
      this.logger_.warn(
        `email-smtp: уведомление без содержимого (шаблон ${
          notification.template || "не указан"
        }) — письмо не отправлено`,
      );
      return {};
    }

    const subject = notification.content?.subject?.trim();

    try {
      const info = await this.transporter_.sendMail({
        from: notification.from?.trim() || this.options_.from,
        to,
        subject: subject || "Уведомление",
        text,
        html,
        attachments: mapAttachments(notification.attachments),
      });

      return { id: info?.messageId ? String(info.messageId) : undefined };
    } catch (error) {
      // Причина отказа SMTP (аутентификация, лимит, неверный адрес) видна
      // только в тексте ошибки — в журнал уведомлений уходит именно она.
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        `email-smtp: письмо не отправлено: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}

/**
 * Вложения Medusa в формат nodemailer.
 *
 * Medusa хранит содержимое вложения строкой base64 (так же его понимают
 * SendGrid и Resend), а nodemailer по умолчанию считает строку текстом — без
 * явного `encoding` вложение приехало бы к покупателю нечитаемым.
 */
export function mapAttachments(
  attachments: NotificationTypes.ProviderSendNotificationDTO["attachments"],
) {
  if (!Array.isArray(attachments) || attachments.length === 0) {
    return undefined;
  }

  return attachments.map((attachment) => ({
    filename: attachment.filename,
    content: attachment.content,
    encoding: "base64" as const,
    contentType: attachment.content_type,
    contentDisposition: attachment.disposition === "inline" ? ("inline" as const) : undefined,
    cid: attachment.id ?? undefined,
  }));
}

export default EmailSmtpNotificationProviderService;
