/**
 * Тесты провайдера против подменённого `fetch`.
 *
 * Терминал для них не нужен: проверяется, что в банк уходит корректный
 * запрос и что ответ отображается в корректное состояние Medusa. Сквозная
 * проверка на тестовом терминале — отдельный шаг (§13).
 */

import { TBankPaymentProviderService } from "../service";
import { generateToken } from "../lib/token";
import { TBANK_NOTIFICATION_MODULE } from "../../tbank-notifications";

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

function makeService(notificationStore?: unknown) {
  return new TBankPaymentProviderService(
    {
      logger,
      ...(notificationStore ? { [TBANK_NOTIFICATION_MODULE]: notificationStore } : {}),
    } as never,
    OPTIONS as never,
  );
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
    const fetchMock = mockFetchOnce({
      Success: true,
      ErrorCode: "0",
      PaymentId: "1",
      PaymentURL: "https://securepay.tinkoff.ru/xxx",
    });
    await makeService().initiatePayment(input as never);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.PayType).toBe("O");
  });

  it("кладёт в OrderId идентификатор сессии, а не корзины", async () => {
    const fetchMock = mockFetchOnce({
      Success: true,
      ErrorCode: "0",
      PaymentId: "1",
      PaymentURL: "https://securepay.tinkoff.ru/xxx",
    });
    await makeService().initiatePayment(input as never);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.OrderId).toBe("payses_01JABCDEFGHJKMNPQRSTVWXYZ");
    expect(body.OrderId.length).toBeLessThanOrEqual(36);
  });

  it("подписывает запрос корректным токеном", async () => {
    const fetchMock = mockFetchOnce({
      Success: true,
      ErrorCode: "0",
      PaymentId: "1",
      PaymentURL: "https://securepay.tinkoff.ru/xxx",
    });
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

  describe("Task 5 hardening: idempotency, indeterminate timeout, origin validation", () => {
    it("идемпотентный повтор: при наличии активной попытки возвращает её без повторного Init", async () => {
      const fetchMock = jest.fn();
      global.fetch = fetchMock as unknown as typeof fetch;

      const inputWithExistingSession = {
        ...input,
        data: {
          paymentId: "3456789",
          paymentUrl: "https://securepay.tinkoff.ru/xxx",
          orderId: "payses_01JABCDEFGHJKMNPQRSTVWXYZ",
          status: "NEW",
          cartSnapshot: {
            amountKopecks: 1899000,
            currencyCode: "rub",
            orderId: "payses_01JABCDEFGHJKMNPQRSTVWXYZ",
          },
        },
      };

      const result = await makeService().initiatePayment(inputWithExistingSession as never);

      expect(fetchMock).not.toHaveBeenCalled();
      expect(result.status).toBe("pending_authorization");
      expect(result.id).toBe("3456789");
      expect((result.data as Record<string, unknown>).paymentUrl).toBe(
        "https://securepay.tinkoff.ru/xxx",
      );
    });

    it("запрещает повторное использование, если корзина изменилась по сумме", async () => {
      const inputWithModifiedAmount = {
        ...input,
        amount: 25000, // изменилась сумма
        data: {
          paymentId: "3456789",
          paymentUrl: "https://securepay.tinkoff.ru/xxx",
          cartSnapshot: {
            amountKopecks: 1899000,
            currencyCode: "rub",
            orderId: "payses_01JABCDEFGHJKMNPQRSTVWXYZ",
          },
        },
      };

      await expect(
        makeService().initiatePayment(inputWithModifiedAmount as never),
      ).rejects.toThrow(/сумма или валюта корзины изменилась/);
    });

    it("запрещает повторное использование, если изменилась версия корзины", async () => {
      const inputWithModifiedVersion = {
        ...input,
        context: {
          idempotency_key: "payses_01JABCDEFGHJKMNPQRSTVWXYZ",
          cart_version: 2,
        },
        data: {
          paymentId: "3456789",
          paymentUrl: "https://securepay.tinkoff.ru/xxx",
          cartSnapshot: {
            version: 1,
            amountKopecks: 1899000,
            currencyCode: "rub",
            orderId: "payses_01JABCDEFGHJKMNPQRSTVWXYZ",
          },
        },
      };

      await expect(
        makeService().initiatePayment(inputWithModifiedVersion as never),
      ).rejects.toThrow(/версия корзины изменилась/);
    });

    it("при таймауте Init помечает состояние как indeterminate и выбрасывает ошибку", async () => {
      const abortError = new Error("The operation was aborted");
      abortError.name = "AbortError";
      global.fetch = jest.fn().mockRejectedValue(abortError);

      const sessionData: Record<string, unknown> = {};
      const inputWithData = { ...input, data: sessionData };

      await expect(makeService().initiatePayment(inputWithData as never)).rejects.toThrow(
        /indeterminate/,
      );

      expect(sessionData.status).toBe("indeterminate");
      expect(sessionData.orderId).toBe("payses_01JABCDEFGHJKMNPQRSTVWXYZ");
      expect(sessionData.attemptId).toBeDefined();
    });

    it("при статусе indeterminate не шлёт Init вслепую, а опрашивает GetState если есть paymentId", async () => {
      const fetchMock = mockFetchOnce({
        Success: true,
        ErrorCode: "0",
        PaymentId: "3456789",
        Status: "AUTHORIZED",
      });

      const inputIndeterminate = {
        ...input,
        data: {
          paymentId: "3456789",
          orderId: "payses_01JABCDEFGHJKMNPQRSTVWXYZ",
          status: "indeterminate",
        },
      };

      const result = await makeService().initiatePayment(inputIndeterminate as never);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url] = fetchMock.mock.calls[0];
      expect(url).toContain("GetState");
      expect(result.status).toBe("authorized");
      expect((result.data as Record<string, unknown>).status).toBe("AUTHORIZED");
    });

    it("при статусе indeterminate и отсутствии paymentId опрашивает CheckOrder", async () => {
      const fetchMock = mockFetchOnce({
        Success: true,
        ErrorCode: "0",
        OrderId: "payses_01JABCDEFGHJKMNPQRSTVWXYZ",
        Status: "NEW",
        Payments: [{ PaymentId: "777666", Amount: 1899000, Status: "NEW" }],
      });

      const inputIndeterminateNoId = {
        ...input,
        data: {
          orderId: "payses_01JABCDEFGHJKMNPQRSTVWXYZ",
          status: "indeterminate",
        },
      };

      const result = await makeService().initiatePayment(inputIndeterminateNoId as never);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url] = fetchMock.mock.calls[0];
      expect(url).toContain("CheckOrder");
      expect(result.id).toBe("777666");
      expect(result.status).toBe("pending_authorization");
    });

    it("при статусе indeterminate, если сверка недоступна, блокирует повторный Init", async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error("Connection timeout"));

      const inputIndeterminateFailed = {
        ...input,
        data: {
          orderId: "payses_01JABCDEFGHJKMNPQRSTVWXYZ",
          status: "indeterminate",
        },
      };

      await expect(
        makeService().initiatePayment(inputIndeterminateFailed as never),
      ).rejects.toThrow(/повторный Init заблокирован до сверки/);
    });

    it("отвергает ответ Init без PaymentURL", async () => {
      mockFetchOnce({
        Success: true,
        ErrorCode: "0",
        PaymentId: "123",
      });

      await expect(makeService().initiatePayment(input as never)).rejects.toThrow(
        /не содержит PaymentURL/,
      );
    });

    it("отвергает PaymentURL с протоколом HTTP вместо HTTPS", async () => {
      mockFetchOnce({
        Success: true,
        ErrorCode: "0",
        PaymentId: "123",
        PaymentURL: "http://securepay.tinkoff.ru/pay",
      });

      await expect(makeService().initiatePayment(input as never)).rejects.toThrow(
        /протокол https/,
      );
    });

    it("отвергает PaymentURL со сторонним или фишинговым доменом", async () => {
      mockFetchOnce({
        Success: true,
        ErrorCode: "0",
        PaymentId: "123",
        PaymentURL: "https://evil-attacker.com/tinkoff/pay",
      });

      await expect(makeService().initiatePayment(input as never)).rejects.toThrow(
        /непроверенный хост PaymentURL/,
      );
    });

    it("принимает PaymentURL для тестового и боевого хостов Т-Банка", async () => {
      for (const host of ["securepay.tinkoff.ru", "rest-api-test.tinkoff.ru"]) {
        mockFetchOnce({
          Success: true,
          ErrorCode: "0",
          PaymentId: "123",
          PaymentURL: `https://${host}/v2/pay`,
        });

        const result = await makeService().initiatePayment(input as never);
        expect((result.data as Record<string, unknown>).paymentUrl).toBe(
          `https://${host}/v2/pay`,
        );
      }
    });

    it("отвергает ответ Init при расхождении суммы", async () => {
      mockFetchOnce({
        Success: true,
        ErrorCode: "0",
        PaymentId: "123",
        PaymentURL: "https://securepay.tinkoff.ru/pay",
        Amount: 999999, // не 1899000
      });

      await expect(makeService().initiatePayment(input as never)).rejects.toThrow(
        /сумма ответа Init .* не совпадает/,
      );
    });

    it("отвергает PaymentURL с встроенными учётными данными (credentials)", async () => {
      mockFetchOnce({
        Success: true,
        ErrorCode: "0",
        PaymentId: "123",
        PaymentURL: "https://admin:secret@securepay.tinkoff.ru/v2/pay",
      });

      await expect(makeService().initiatePayment(input as never)).rejects.toThrow(
        /не должен содержать учётные данные/,
      );
    });

    it("дедуплицирует параллельные вызовы initiatePayment для одной сессии (защита от двойного клика)", async () => {
      let resolveFetch: (val: unknown) => void;
      const delayedFetch = new Promise((resolve) => {
        resolveFetch = resolve;
      });

      const fetchMock = jest.fn().mockImplementation(() => delayedFetch);
      global.fetch = fetchMock as unknown as typeof fetch;

      const service = makeService();
      const call1 = service.initiatePayment(input as never);
      const call2 = service.initiatePayment(input as never);

      resolveFetch!({
        ok: true,
        status: 200,
        json: async () => ({
          Success: true,
          ErrorCode: "0",
          PaymentId: "998877",
          PaymentURL: "https://securepay.tinkoff.ru/v2/pay",
          Status: "NEW",
          Amount: 1899000,
        }),
      });

      const [res1, res2] = await Promise.all([call1, call2]);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(res1.id).toBe("998877");
      expect(res2.id).toBe("998877");
    });

    it("отвергает инициализацию, если в БД уже есть попытка с другой суммой", async () => {
      const mockNotificationStore = {
        listTbankNotifications: jest.fn(),
        createTbankNotifications: jest.fn(),
        createTbankNotificationConflicts: jest.fn(),
        listTbankPaymentAttempts: jest.fn().mockResolvedValue([
          {
            id: "tbatt_prev",
            payment_session_id: "payses_01JABCDEFGHJKMNPQRSTVWXYZ",
            order_id: "payses_01JABCDEFGHJKMNPQRSTVWXYZ",
            expected_amount_kopecks: 50000, // отличается от 1899000
            currency_code: "rub",
          },
        ]),
      };

      const service = makeService(mockNotificationStore);
      await expect(service.initiatePayment(input as never)).rejects.toThrow(
        /уже была зарегистрирована в БД с другой суммой/,
      );
    });

    it("сохраняет попытку в tbank_payment_attempt до вызова Init Т-Банка", async () => {
      const mockNotificationStore = {
        listTbankNotifications: jest.fn(),
        createTbankNotifications: jest.fn(),
        createTbankNotificationConflicts: jest.fn(),
        listTbankPaymentAttempts: jest.fn().mockResolvedValue([]),
        createTbankPaymentAttempts: jest.fn().mockResolvedValue({ id: "tbatt_1" }),
      };

      let dbInsertCalledBeforeFetch = false;
      mockNotificationStore.createTbankPaymentAttempts.mockImplementation(async () => {
        dbInsertCalledBeforeFetch = true;
        return { id: "tbatt_1" };
      });

      mockFetchOnce({
        Success: true,
        ErrorCode: "0",
        PaymentId: "12345",
        PaymentURL: "https://securepay.tinkoff.ru/pay",
        Amount: 1899000,
      });

      const service = makeService(mockNotificationStore);
      const res = await service.initiatePayment(input as never);

      expect(dbInsertCalledBeforeFetch).toBe(true);
      expect(mockNotificationStore.createTbankPaymentAttempts).toHaveBeenCalledTimes(1);
      expect(mockNotificationStore.createTbankPaymentAttempts).toHaveBeenCalledWith(
        expect.objectContaining({
          payment_session_id: "payses_01JABCDEFGHJKMNPQRSTVWXYZ",
          order_id: "payses_01JABCDEFGHJKMNPQRSTVWXYZ",
          expected_amount_kopecks: 1899000,
          currency_code: "rub",
        }),
      );
      expect(res.id).toBe("12345");
    });
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

  it("отвергает подтверждение, если сумма банка расходится со снапшотом корзины", async () => {
    mockFetchOnce({
      Success: true,
      ErrorCode: "0",
      PaymentId: "3456789",
      Status: "CONFIRMED",
      Amount: 100000, // 1000 руб вместо 18990 руб
    });

    const sessionWithSnapshot = {
      ...session,
      cartSnapshot: {
        amountKopecks: 1899000,
        currencyCode: "rub",
        orderId: "payses_01JABCDEF",
      },
    };

    await expect(
      makeService().authorizePayment({ data: { ...sessionWithSnapshot } } as never),
    ).rejects.toThrow(/сумма подтверждения банка .* не совпадает со снапшотом корзины/);
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

describe("quarantined scripts (Task 5)", () => {
  it("test-tbank.ts завершается с кодом 1 и сообщением о карантине", () => {
    const exitSpy = jest.spyOn(process, "exit").mockImplementation((code) => {
      throw new Error(`process.exit(${code})`);
    });
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

    expect(() => {
      jest.isolateModules(() => {
        require("../../../scripts/test-tbank");
      });
    }).toThrow("process.exit(1)");

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("test-tbank.ts помещён в карантин"),
    );

    exitSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("test-e2e-checkout.ts завершается с кодом 1 и сообщением о карантине", () => {
    const exitSpy = jest.spyOn(process, "exit").mockImplementation((code) => {
      throw new Error(`process.exit(${code})`);
    });
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

    expect(() => {
      jest.isolateModules(() => {
        require("../../../scripts/test-e2e-checkout");
      });
    }).toThrow("process.exit(1)");

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("test-e2e-checkout.ts помещён в карантин"),
    );

    exitSpy.mockRestore();
    errorSpy.mockRestore();
  });
});

