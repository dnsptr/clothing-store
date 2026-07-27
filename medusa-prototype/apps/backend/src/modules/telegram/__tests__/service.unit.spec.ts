import {
  TelegramNotificationProviderService,
  truncateForTelegram,
} from "../service";

const OPTIONS = {
  botToken: "123456:TESTTOKEN",
  defaultChatId: "-1001234567890",
  apiBaseUrl: "https://api.telegram.example",
};

const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };

function makeService(options: Partial<typeof OPTIONS> = {}) {
  return new TelegramNotificationProviderService({ logger } as never, {
    ...OPTIONS,
    ...options,
  } as never);
}

function mockFetch(body: Record<string, unknown>, ok = true, status = 200) {
  const fetchMock = jest.fn().mockResolvedValue({ ok, status, json: async () => body });
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

const OK_RESPONSE = { ok: true, result: { message_id: 42 } };

beforeEach(() => jest.clearAllMocks());

describe("validateOptions", () => {
  it("требует botToken", () => {
    expect(() => TelegramNotificationProviderService.validateOptions({})).toThrow();
    expect(() =>
      TelegramNotificationProviderService.validateOptions({ botToken: "x" }),
    ).not.toThrow();
  });
});

describe("send", () => {
  const notification = {
    to: "-100999",
    channel: "telegram",
    template: "order-placed",
    content: { text: "Новый заказ №1042" },
  };

  it("отправляет текст в указанный чат", async () => {
    const fetchMock = mockFetch(OK_RESPONSE);

    const result = await makeService().send(notification as never);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.telegram.example/bot123456:TESTTOKEN/sendMessage");
    const body = JSON.parse(init.body as string);
    expect(body.chat_id).toBe("-100999");
    expect(body.text).toBe("Новый заказ №1042");
    expect(result.id).toBe("42");
  });

  it("не включает parse_mode", async () => {
    const fetchMock = mockFetch(OK_RESPONSE);
    await makeService().send(notification as never);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    // С разметкой пришлось бы экранировать имена и адреса покупателей, и
    // первая же фамилия с подчёркиванием ломала бы отправку.
    expect(body.parse_mode).toBeUndefined();
  });

  it("падает обратно на чат по умолчанию", async () => {
    const fetchMock = mockFetch(OK_RESPONSE);
    await makeService().send({ ...notification, to: "" } as never);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.chat_id).toBe(OPTIONS.defaultChatId);
  });

  it("без получателя и без чата по умолчанию — ошибка", async () => {
    mockFetch(OK_RESPONSE);
    await expect(
      makeService({ defaultChatId: undefined }).send({ ...notification, to: "" } as never),
    ).rejects.toThrow(/получател/);
  });

  it("берёт текст из data, если content пуст", async () => {
    const fetchMock = mockFetch(OK_RESPONSE);
    await makeService().send({
      ...notification,
      content: undefined,
      data: { text: "из data" },
    } as never);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.text).toBe("из data");
  });

  it("отвергает пустой текст, а не отправляет пустое сообщение", async () => {
    mockFetch(OK_RESPONSE);
    await expect(
      makeService().send({ ...notification, content: { text: "   " } } as never),
    ).rejects.toThrow(/пустой текст/);
  });

  it("ok: false при HTTP 200 — это ошибка", async () => {
    // Telegram умеет отвечать 200 с ok: false, поэтому проверять только статус
    // недостаточно.
    mockFetch({ ok: false, description: "chat not found" }, true, 200);

    await expect(makeService().send(notification as never)).rejects.toThrow(
      /chat not found/,
    );
  });

  it("сообщает HTTP-ошибку", async () => {
    mockFetch({ ok: false, description: "Unauthorized" }, false, 401);
    await expect(makeService().send(notification as never)).rejects.toThrow(/401/);
  });
});

describe("truncateForTelegram", () => {
  it("не трогает сообщение в пределах лимита", () => {
    const text = "короткое";
    expect(truncateForTelegram(text)).toBe(text);
  });

  it("укладывает длинное сообщение в лимит", () => {
    const long = "я".repeat(5000);
    const result = truncateForTelegram(long);

    // Сообщение длиннее 4096 Telegram отвергает целиком: усечённое уведомление
    // о заказе лучше, чем никакого.
    expect(Array.from(result).length).toBeLessThanOrEqual(4096);
    expect(result).toContain("сообщение усечено");
  });

  it("считает длину в кодовых точках, а не в UTF-16", () => {
    // Эмодзи занимает две единицы UTF-16: наивная length обрезала бы по
    // середине суррогатной пары и дала бы битый символ.
    const emoji = "😀".repeat(3000);
    const result = truncateForTelegram(emoji);

    expect(Array.from(result).length).toBeLessThanOrEqual(4096);
    expect(result).not.toContain("�");
  });
});
