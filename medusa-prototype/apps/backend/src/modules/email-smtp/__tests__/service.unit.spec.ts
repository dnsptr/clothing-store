/**
 * Тесты почтового провайдера.
 *
 * nodemailer замокан целиком: проверяется наш код — что уходит в `sendMail`,
 * как настраивается транспорт и что происходит с отказом сервера. Живой SMTP
 * здесь не нужен и вреден: тест не должен зависеть от чужого хостинга.
 *
 * Имена моков начинаются с `mock` намеренно: `jest.mock` поднимается выше
 * объявлений, и только такие переменные разрешено упоминать в фабрике.
 */

const mockSendMail = jest.fn();
const mockCreateTransport = jest.fn((_config: Record<string, unknown>) => ({
  sendMail: mockSendMail,
}));

jest.mock("nodemailer", () => ({
  __esModule: true,
  default: {
    createTransport: (config: Record<string, unknown>) => mockCreateTransport(config),
  },
  createTransport: (config: Record<string, unknown>) => mockCreateTransport(config),
}));

import { EmailSmtpNotificationProviderService, mapAttachments } from "../service";

const OPTIONS = {
  host: "smtp.example.ru",
  port: 587,
  user: "shop@example.ru",
  password: "s3cret",
  from: "Mario Mikke <shop@example.ru>",
};

const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };

function makeService(options: Record<string, unknown> = {}) {
  return new EmailSmtpNotificationProviderService({ logger } as never, {
    ...OPTIONS,
    ...options,
  } as never);
}

/** Настройки транспорта, с которыми был создан nodemailer. */
function transportConfig(): Record<string, unknown> {
  return mockCreateTransport.mock.calls[0][0];
}

const NOTIFICATION = {
  to: "buyer@example.com",
  channel: "email",
  template: "order-placed",
  content: {
    subject: "Mario Mikke: заказ №1042 принят",
    text: "Здравствуйте, Анна!",
    html: "<p>Здравствуйте, Анна!</p>",
  },
};

beforeEach(() => {
  jest.clearAllMocks();
  mockSendMail.mockResolvedValue({ messageId: "<msg-42@example.ru>" });
});

describe("validateOptions", () => {
  it.each(["host", "user", "password", "from"])("требует %s", (key) => {
    const options: Record<string, unknown> = { ...OPTIONS };
    delete options[key];

    expect(() => EmailSmtpNotificationProviderService.validateOptions(options)).toThrow(
      new RegExp(key),
    );
  });

  it("принимает полный набор", () => {
    expect(() =>
      EmailSmtpNotificationProviderService.validateOptions({ ...OPTIONS }),
    ).not.toThrow();
  });
});

describe("транспорт", () => {
  it("на 465 порту включает неявный TLS", () => {
    makeService({ port: 465 });

    expect(transportConfig().secure).toBe(true);
    // На неявном TLS требовать STARTTLS нечего: канал уже зашифрован.
    expect(transportConfig().requireTLS).toBe(false);
  });

  it("на 587 порту требует STARTTLS", () => {
    makeService({ port: 587 });

    expect(transportConfig().secure).toBe(false);
    // Иначе логин и пароль ящика уехали бы открытым текстом.
    expect(transportConfig().requireTLS).toBe(true);
  });

  it("подчиняется явно заданному режиму", () => {
    makeService({ port: 2525, secure: true });

    expect(transportConfig().secure).toBe(true);
  });

  it("берёт 587, если порт не задан", () => {
    makeService({ port: undefined });

    expect(transportConfig().port).toBe(587);
  });

  it("задаёт таймауты", () => {
    makeService();

    // Без них зависший SMTP держал бы воркер, и очередь уведомлений встала бы.
    expect(Number(transportConfig().connectionTimeout)).toBeGreaterThan(0);
    expect(Number(transportConfig().greetingTimeout)).toBeGreaterThan(0);
    expect(Number(transportConfig().socketTimeout)).toBeGreaterThan(0);
  });
});

describe("send", () => {
  it("отправляет письмо и возвращает id сообщения", async () => {
    const result = await makeService().send(NOTIFICATION as never);

    expect(mockSendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: OPTIONS.from,
        to: "buyer@example.com",
        subject: NOTIFICATION.content.subject,
        text: NOTIFICATION.content.text,
        html: NOTIFICATION.content.html,
      }),
    );
    expect(result.id).toBe("<msg-42@example.ru>");
  });

  it("предпочитает отправителя из уведомления", async () => {
    await makeService().send({ ...NOTIFICATION, from: "sale@example.ru" } as never);

    expect(mockSendMail).toHaveBeenCalledWith(
      expect.objectContaining({ from: "sale@example.ru" }),
    );
  });

  it("отправляет письмо только с текстом", async () => {
    await makeService().send({
      ...NOTIFICATION,
      content: { subject: "Тема", text: "Только текст" },
    } as never);

    const mail = mockSendMail.mock.calls[0][0];
    expect(mail.text).toBe("Только текст");
    expect(mail.html).toBeUndefined();
  });

  it("без получателя — ошибка", async () => {
    await expect(makeService().send({ ...NOTIFICATION, to: "  " } as never)).rejects.toThrow(
      /получател/,
    );
    expect(mockSendMail).not.toHaveBeenCalled();
  });

  it("уведомление без содержимого не отправляет и не роняет", async () => {
    // В канал `email` пишет не только наш подписчик: штатный
    // `configurable-notifications` Medusa создаёт уведомление без `content` на
    // каждый заказ. Ошибка красила бы журнал уведомлений на ровном месте.
    const result = await makeService().send({
      to: "buyer@example.com",
      channel: "email",
      template: "order-created-template",
      data: { order_id: "order_1" },
    } as never);

    expect(result).toEqual({});
    expect(mockSendMail).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalled();
  });

  it("пустой текст считается отсутствующим", async () => {
    await makeService().send({ ...NOTIFICATION, content: { text: "   ", html: "" } } as never);

    expect(mockSendMail).not.toHaveBeenCalled();
  });

  it("сообщает причину отказа SMTP", async () => {
    mockSendMail.mockRejectedValue(new Error("535 Authentication failed"));

    // Причина отказа видна только в тексте ошибки — она и должна доехать до
    // журнала уведомлений.
    await expect(makeService().send(NOTIFICATION as never)).rejects.toThrow(
      /535 Authentication failed/,
    );
  });

  it("подставляет тему, если её не собрали", async () => {
    await makeService().send({
      ...NOTIFICATION,
      content: { text: "Текст без темы" },
    } as never);

    expect(mockSendMail.mock.calls[0][0].subject).toBeTruthy();
  });
});

describe("mapAttachments", () => {
  it("без вложений ничего не передаёт", () => {
    expect(mapAttachments(undefined)).toBeUndefined();
    expect(mapAttachments([])).toBeUndefined();
  });

  it("сохраняет кодировку base64", () => {
    // Medusa хранит вложение строкой base64, а nodemailer без явной кодировки
    // считает строку текстом — файл приехал бы битым.
    const attachments = mapAttachments([
      {
        content: "SGVsbG8=",
        filename: "check.pdf",
        content_type: "application/pdf",
        disposition: "attachment",
      },
    ]);

    expect(attachments?.[0]).toMatchObject({
      filename: "check.pdf",
      content: "SGVsbG8=",
      encoding: "base64",
      contentType: "application/pdf",
    });
  });
});
