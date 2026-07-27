/**
 * Тесты провайдера против подменённого `fetch`.
 *
 * Терминал для них не нужен: проверяется, что в банк уходит корректный
 * запрос и что ответ отображается в корректное состояние Medusa. Сквозная
 * проверка на тестовом терминале — отдельный шаг (§13).
 */

import { TBankPaymentProviderService } from "../service";
import { generateToken } from "../lib/token";

const OPTIONS = {
  terminalKey: "TinkoffBankTest",
  password: "TinkoffBankTest",
  apiBaseUrl: "https://rest-api-test.tinkoff.ru/v2",
  notificationUrl: "https://api.mariomikke.shop/hooks/payment/tbank",
};

const logger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
};

function makeService() {
  return new TBankPaymentProviderService({ logger } as never, OPTIONS as never);
}

function mockFetchOnce(body: Record<string, unknown>, ok = true, status = 200) {
  const fetchMock = jest.fn().mockResolvedValue({
    ok,
    status,
    json: async () => body,
  });
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("validateOptions", () => {
  it("требует terminalKey и password", () => {
    expect(() => TBankPaymentProviderService.validateOptions({})).toThrow();
    expect(() =>
      TBankPaymentProviderService.validateOptions({ terminalKey: "x" }),
    ).toThrow();
    expect(() =>
      TBankPaymentProviderService.validateOptions({ terminalKey: "x", password: "y" }),
    ).not.toThrow();
  });
});

describe("initiatePayment", () => {
  const input = {
    amount: 18990,
    currency_code: "rub",
    context: { idempotency_key: "payses_01JABCDEFGHJKMNPQRSTVWXYZ" },
  };

  it("отправляет сумму в копейках, а не в рублях", async () => {
    const fetchMock = mockFetchOnce({
      Success: true,
      ErrorCode: "0",
      PaymentId: "3456789",
      PaymentURL: "https://securepay.tinkoff.ru/xxx",
      Status: "NEW",
    });

    await makeService().initiatePayment(input as never);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    // 18 990 ₽ → 1 899 000 копеек. Ошибка масштаба здесь — списание в сто раз
    // больше или меньше.
    expect(body.Amount).toBe(1899000);
    expect(body.Amount).not.toBe(18990);
  });

  it("использует одностадийную оплату", async () => {
    const fetchMock = mockFetchOnce({ Success: true, ErrorCode: "0", PaymentId: "1" });
    await makeService().initiatePayment(input as never);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.PayType).toBe("O");
  });

  it("кладёт в OrderId идентификатор сессии, а не корзины", async () => {
    const fetchMock = mockFetchOnce({ Success: true, ErrorCode: "0", PaymentId: "1" });
    await makeService().initiatePayment(input as never);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.OrderId).toBe("payses_01JABCDEFGHJKMNPQRSTVWXYZ");
    expect(body.OrderId.length).toBeLessThanOrEqual(36);
  });

  it("подписывает запрос корректным токеном", async () => {
    const fetchMock = mockFetchOnce({ Success: true, ErrorCode: "0", PaymentId: "1" });
    await makeService().initiatePayment(input as never);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    const { Token, ...withoutToken } = body;
    expect(Token).toBe(generateToken(withoutToken, OPTIONS.password));
  });

  it("возвращает pending_authorization, а не pending", async () => {
    mockFetchOnce({
      Success: true,
      ErrorCode: "0",
      PaymentId: "3456789",
      PaymentURL: "https://securepay.tinkoff.ru/xxx",
    });

    const result = await makeService().initiatePayment(input as never);

    // Покупатель ушёл на форму банка, исход неизвестен — ровно то состояние,
    // ради которого значение появилось в 2.17.2.
    expect(result.status).toBe("pending_authorization");
    expect(result.id).toBe("3456789");
    expect((result.data as Record<string, unknown>).paymentUrl).toBe(
      "https://securepay.tinkoff.ru/xxx",
    );
  });

  it("отвергает валюту, отличную от RUB", async () => {
    mockFetchOnce({ Success: true, ErrorCode: "0" });
    await expect(
      makeService().initiatePayment({ ...input, currency_code: "usd" } as never),
    ).rejects.toThrow(/RUB/);
  });

  it("без idempotency_key не придумывает случайный OrderId", async () => {
    mockFetchOnce({ Success: true, ErrorCode: "0" });
    // Случайный OrderId означал бы, что повтор запроса создаёт второй платёж.
    await expect(
      makeService().initiatePayment({ ...input, context: {} } as never),
    ).rejects.toThrow(/idempotency_key/);
  });

  it("Success: false в теле — это ошибка, несмотря на HTTP 200", async () => {
    mockFetchOnce({
      Success: false,
      ErrorCode: "1051",
      Message: "Недостаточно средств",
    });
    await expect(makeService().initiatePayment(input as never)).rejects.toThrow(/1051/);
  });
});

describe("getWebhookActionAndData", () => {
  function signedNotification(overrides: Record<string, unknown> = {}) {
    const body: Record<string, unknown> = {
      TerminalKey: OPTIONS.terminalKey,
      OrderId: "payses_01JABCDEF",
      PaymentId: 3456789,
      Status: "CONFIRMED",
      Amount: 1899000,
      Success: true,
      ...overrides,
    };
    body.Token = generateToken(body, OPTIONS.password);
    return body;
  }

  it("отображает подписанную нотификацию по таблице §4.3", async () => {
    const result = await makeService().getWebhookActionAndData({
      data: signedNotification(),
    } as never);

    expect(result.action).toBe("captured");
    expect(result.data?.session_id).toBe("payses_01JABCDEF");
    expect(result.data?.amount).toBe("18990.00");
  });

  it("отбрасывает нотификацию с неверной подписью", async () => {
    const body = signedNotification();
    body.Amount = 1; // сумма подменена после подписи

    const result = await makeService().getWebhookActionAndData({ data: body } as never);

    // Не «неуспешный платёж», а подделка либо расхождение конфигурации:
    // Medusa не должна сделать ничего.
    expect(result.action).toBe("not_supported");
    expect(result.data).toBeUndefined();
  });

  it("нетерминальный статус не создаёт заказ", async () => {
    for (const status of ["NEW", "FORM_SHOWED", "AUTHORIZING", "3DS_CHECKING"]) {
      const result = await makeService().getWebhookActionAndData({
        data: signedNotification({ Status: status }),
      } as never);
      expect(result.action).toBe("not_supported");
    }
  });

  it("не падает на неразбираемой нотификации", async () => {
    const body: Record<string, unknown> = { TerminalKey: OPTIONS.terminalKey };
    body.Token = generateToken(body, OPTIONS.password);

    const result = await makeService().getWebhookActionAndData({ data: body } as never);
    expect(result.action).toBe("not_supported");
  });
});

describe("getPaymentStatus", () => {
  it("без PaymentId возвращает pending, а не ошибку", async () => {
    const result = await makeService().getPaymentStatus({ data: {} } as never);
    expect(result.status).toBe("pending");
  });

  it("опрашивает банк и отображает статус", async () => {
    mockFetchOnce({
      Success: true,
      ErrorCode: "0",
      PaymentId: "3456789",
      Status: "CONFIRMED",
    });

    const result = await makeService().getPaymentStatus({
      data: { paymentId: "3456789" },
    } as never);

    expect(result.status).toBe("captured");
  });
});

describe("authorizePayment", () => {
  /**
   * Данные сессии в том виде, в каком они лежат в БД к моменту авторизации:
   * `status` записан один раз в `initiatePayment` из ответа `Init` и с тех пор
   * никем не обновлялся. Если верить ему, платёж навсегда останется `NEW`.
   */
  const session = {
    paymentId: "3456789",
    paymentUrl: "https://securepay.tinkoff.ru/xxx",
    orderId: "payses_01JABCDEF",
    status: "NEW",
  };

  it("спрашивает банк, а не протухший status из данных сессии", async () => {
    const fetchMock = mockFetchOnce({
      Success: true,
      ErrorCode: "0",
      PaymentId: "3456789",
      Status: "AUTHORIZED",
    });

    const result = await makeService().authorizePayment({ data: { ...session } } as never);

    expect(fetchMock.mock.calls[0][0]).toContain("/GetState");
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.PaymentId).toBe("3456789");
    expect(result.status).toBe("authorized");
  });

  it("на CONFIRMED возвращает captured", async () => {
    mockFetchOnce({
      Success: true,
      ErrorCode: "0",
      PaymentId: "3456789",
      Status: "CONFIRMED",
    });

    const result = await makeService().authorizePayment({ data: { ...session } } as never);

    // Ответ pending_authorization здесь означал бы payment_id: undefined в
    // capturePaymentWorkflow и заказ, навсегда оставшийся неоплаченным.
    expect(result.status).toBe("captured");
  });

  it("на REJECTED возвращает error", async () => {
    mockFetchOnce({
      Success: true,
      ErrorCode: "0",
      PaymentId: "3456789",
      Status: "REJECTED",
    });

    const result = await makeService().authorizePayment({ data: { ...session } } as never);

    expect(result.status).toBe("error");
  });

  it("сохраняет в данных сессии свежий Status банка", async () => {
    mockFetchOnce({
      Success: true,
      ErrorCode: "0",
      PaymentId: "3456789",
      Status: "CONFIRMED",
    });

    const result = await makeService().authorizePayment({ data: { ...session } } as never);

    const data = result.data as Record<string, unknown>;
    expect(data.status).toBe("CONFIRMED");
    expect(data.paymentId).toBe("3456789");
    expect(data.orderId).toBe("payses_01JABCDEF");
  });

  it("не валит оформление, если банк не ответил", async () => {
    global.fetch = jest
      .fn()
      .mockRejectedValue(new Error("socket hang up")) as unknown as typeof fetch;

    const result = await makeService().authorizePayment({ data: { ...session } } as never);

    // Недоступность банка — не исход платежа: сессия остаётся ожидающей, а
    // исход доберут повторная нотификация и сверка.
    expect(result.status).toBe("pending_authorization");
    expect((result.data as Record<string, unknown>).status).toBe("NEW");
    expect(logger.warn).toHaveBeenCalled();
  });

  it("без PaymentId не обращается в банк", async () => {
    const fetchMock = mockFetchOnce({ Success: true, ErrorCode: "0" });

    const result = await makeService().authorizePayment({ data: {} } as never);

    // Платёж не создавался — спрашивать не о чем, и это не ошибка.
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.status).toBe("pending_authorization");
  });
});

describe("cancelPayment", () => {
  it("без PaymentId не обращается в банк", async () => {
    const fetchMock = mockFetchOnce({ Success: true, ErrorCode: "0" });
    await makeService().cancelPayment({ data: {} } as never);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("считает ошибку отмены идемпотентной только после GetState=CANCELED", async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ Success: false, ErrorCode: "9999", Message: "уже отменён" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ Success: true, ErrorCode: "0", Status: "CANCELED" }),
      }) as unknown as typeof fetch;

    await expect(
      makeService().cancelPayment({ data: { paymentId: "1" } } as never),
    ).resolves.toBeDefined();
  });

  it("не удаляет сессию после неоднозначной сетевой ошибки Cancel", async () => {
    global.fetch = jest
      .fn()
      .mockRejectedValueOnce(new Error("socket reset"))
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ Success: true, ErrorCode: "0", Status: "NEW" }),
      }) as unknown as typeof fetch;

    await expect(
      makeService().cancelPayment({ data: { paymentId: "1" } } as never),
    ).rejects.toThrow(/NETWORK/);
  });
});

describe("refundPayment", () => {
  it("без PaymentId бросает, а не делает вид, что вернул деньги", async () => {
    await expect(
      makeService().refundPayment({ data: {}, amount: 100 } as never),
    ).rejects.toThrow(/PaymentId/);
  });

  it("отправляет сумму возврата в копейках", async () => {
    const fetchMock = mockFetchOnce({ Success: true, ErrorCode: "0" });
    await makeService().refundPayment({
      data: { paymentId: "3456789" },
      amount: 18990,
    } as never);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.Amount).toBe(1899000);
  });
});

describe("capturePayment", () => {
  it("при одностадийной оплате не обращается в банк", async () => {
    const fetchMock = mockFetchOnce({ Success: true, ErrorCode: "0" });
    await makeService().capturePayment({ data: { paymentId: "1" } } as never);
    // Списание уже произошло к моменту CONFIRMED — подтверждать нечего.
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
