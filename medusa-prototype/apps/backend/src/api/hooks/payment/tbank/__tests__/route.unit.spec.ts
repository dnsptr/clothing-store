/**
 * Тесты роута нотификаций — без БД и без сети.
 *
 * Проверяется порядок операций, а не интеграция: подпись раньше журнала,
 * журнал раньше ответа `OK`, событие после журнала. Каждый из этих порядков
 * защищает от конкретной атаки или потери платежа, и перепутать их легко.
 */

import { POST } from "../route";
import { generateToken } from "../../../../../modules/tbank/lib/token";

const PASSWORD = "TinkoffBankTest";

const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };

function makeNotifications(overrides: Record<string, unknown> = {}) {
  return {
    listTbankNotifications: jest.fn().mockResolvedValue([]),
    createTbankNotifications: jest.fn().mockResolvedValue({}),
    ...overrides,
  };
}

function makeReq(body: Record<string, unknown>, notifications: unknown, eventBus: unknown) {
  return {
    body,
    rawBody: Buffer.from(JSON.stringify(body)),
    headers: {},
    scope: {
      resolve: (key: string) => {
        if (key === "logger") return logger;
        if (key === "tbankNotification") return notifications;
        return eventBus;
      },
    },
  } as never;
}

type ResMock = {
  statusCode: number;
  body: unknown;
  status: jest.Mock;
  send: jest.Mock;
};

function makeRes(): ResMock {
  const res: ResMock = {
    statusCode: 200,
    body: undefined,
    status: jest.fn(),
    send: jest.fn(),
  };
  // Реализации навешиваются после создания объекта: ссылаться на `res` внутри
  // его собственного литерала нельзя — тип получился бы рекурсивным.
  res.status.mockImplementation((code: number) => {
    res.statusCode = code;
    return res;
  });
  res.send.mockImplementation((payload: unknown) => {
    res.body = payload;
    return res;
  });
  return res;
}

function signed(overrides: Record<string, unknown> = {}) {
  const body: Record<string, unknown> = {
    TerminalKey: "TinkoffBankTest",
    OrderId: "payses_01JABCDEF",
    PaymentId: 3456789,
    Status: "CONFIRMED",
    Amount: 1899000,
    Success: true,
    ...overrides,
  };
  body.Token = generateToken(body, PASSWORD);
  return body;
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.TBANK_PASSWORD = PASSWORD;
});

describe("роут нотификаций Т-Банка", () => {
  it("подтверждает приём телом ровно «OK»", async () => {
    const notifications = makeNotifications();
    const eventBus = { emit: jest.fn().mockResolvedValue(undefined) };
    const res = makeRes();

    await POST(makeReq(signed(), notifications, eventBus), res as never);

    // Банк проверяет тело буквально: заглавными, без тегов и пробелов.
    expect(res.send).toHaveBeenCalledWith("OK");
    expect(res.status).not.toHaveBeenCalled();
  });

  it("записывает факт до того, как отдаёт событие наружу", async () => {
    const order: string[] = [];
    const notifications = makeNotifications({
      createTbankNotifications: jest.fn(async () => {
        order.push("journal");
      }),
    });
    const eventBus = {
      emit: jest.fn(async () => {
        order.push("event");
      }),
    };

    await POST(makeReq(signed(), notifications, eventBus), makeRes() as never);

    // Обратный порядок означал бы, что упавшая запись журнала оставляет
    // обработку запущенной, а повтор от банка обработается второй раз.
    expect(order).toEqual(["journal", "event"]);
  });

  it("эмитит полный provider token зарегистрированного провайдера Medusa", async () => {
    const eventBus = { emit: jest.fn().mockResolvedValue(undefined) };

    await POST(makeReq(signed(), makeNotifications(), eventBus), makeRes() as never);

    expect(eventBus.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ provider: "tbank_tbank" }),
      }),
      expect.any(Object),
    );
  });

  it("сохраняет разобранные поля нотификации", async () => {
    const notifications = makeNotifications();
    await POST(
      makeReq(signed(), notifications, { emit: jest.fn() }),
      makeRes() as never,
    );

    expect(notifications.createTbankNotifications).toHaveBeenCalledWith({
      payment_id: "3456789",
      status: "CONFIRMED",
      order_id: "payses_01JABCDEF",
      amount_kopecks: 1899000,
      success: true,
      error_code: null,
      message: null,
    });
  });

  describe("подпись", () => {
    it("отвергает подменённое после подписи тело и не пишет в журнал", async () => {
      const body = signed();
      body.Amount = 1;

      const notifications = makeNotifications();
      const eventBus = { emit: jest.fn() };
      const res = makeRes();

      await POST(makeReq(body, notifications, eventBus), res as never);

      expect(res.status).toHaveBeenCalledWith(401);
      // Ключевое: журнал не тронут. Иначе кто угодно занял бы пару
      // (PaymentId, Status) выдуманным уведомлением и заставил нас отбросить
      // настоящее как дубликат.
      expect(notifications.createTbankNotifications).not.toHaveBeenCalled();
      expect(eventBus.emit).not.toHaveBeenCalled();
    });

    it("не отвечает OK при неверной подписи — банк должен повторить", async () => {
      const res = makeRes();
      await POST(
        makeReq({ ...signed(), Token: "deadbeef" }, makeNotifications(), { emit: jest.fn() }),
        res as never,
      );
      expect(res.body).not.toBe("OK");
    });

    it("без TBANK_PASSWORD отказывается принимать уведомление", async () => {
      delete process.env.TBANK_PASSWORD;
      const notifications = makeNotifications();
      const res = makeRes();

      await POST(makeReq(signed(), notifications, { emit: jest.fn() }), res as never);

      expect(res.status).toHaveBeenCalledWith(503);
      expect(notifications.createTbankNotifications).not.toHaveBeenCalled();
    });
  });

  describe("дедупликация", () => {
    it("повтор подтверждается, но не обрабатывается заново", async () => {
      const notifications = makeNotifications({
        listTbankNotifications: jest.fn().mockResolvedValue([{ id: "tbnotif_1" }]),
      });
      const eventBus = { emit: jest.fn() };
      const res = makeRes();

      await POST(makeReq(signed(), notifications, eventBus), res as never);

      // Банк шлёт повторы раз в час сутки, затем раз в сутки месяц. Ответить
      // надо, обработать — нет.
      expect(res.send).toHaveBeenCalledWith("OK");
      expect(notifications.createTbankNotifications).not.toHaveBeenCalled();
      expect(eventBus.emit).not.toHaveBeenCalled();
    });

    it("проигранная гонка за уникальный индекс считается повтором", async () => {
      const notifications = makeNotifications({
        listTbankNotifications: jest
          .fn()
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([{ id: "tbnotif_1" }]),
        createTbankNotifications: jest.fn().mockRejectedValue(new Error("unique violation")),
      });
      const eventBus = { emit: jest.fn() };
      const res = makeRes();

      await POST(makeReq(signed(), notifications, eventBus), res as never);

      expect(res.send).toHaveBeenCalledWith("OK");
      expect(eventBus.emit).not.toHaveBeenCalled();
    });

    it("ключ — пара, поэтому AUTHORIZED и CONFIRMED не схлопываются", async () => {
      const notifications = makeNotifications();
      await POST(
        makeReq(signed({ Status: "AUTHORIZED" }), notifications, { emit: jest.fn() }),
        makeRes() as never,
      );

      expect(notifications.listTbankNotifications).toHaveBeenCalledWith({
        payment_id: "3456789",
        status: "AUTHORIZED",
      });
    });
  });

  describe("отказы", () => {
    it("не подтверждает приём, если журнал не записался", async () => {
      const notifications = makeNotifications({
        createTbankNotifications: jest.fn().mockRejectedValue(new Error("db down")),
      });
      const eventBus = { emit: jest.fn() };
      const res = makeRes();

      await POST(makeReq(signed(), notifications, eventBus), res as never);

      // Ответить OK здесь — значит потерять платёж: банк больше не повторит.
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.body).not.toBe("OK");
      expect(eventBus.emit).not.toHaveBeenCalled();
    });

    it("подтверждает приём, если факт записан, но событие не поставилось", async () => {
      const notifications = makeNotifications();
      const eventBus = { emit: jest.fn().mockRejectedValue(new Error("redis down")) };
      const res = makeRes();

      await POST(makeReq(signed(), notifications, eventBus), res as never);

      // Платёж уже в БД, его подберёт сверка. Повтор от банка ничего не даст —
      // ключ дедупликации занят, поэтому просить повтор бессмысленно.
      expect(res.send).toHaveBeenCalledWith("OK");
      expect(logger.error).toHaveBeenCalled();
    });

    it("отвергает тело, которое не разбирается, несмотря на верную подпись", async () => {
      const body: Record<string, unknown> = { TerminalKey: "TinkoffBankTest" };
      body.Token = generateToken(body, PASSWORD);

      const notifications = makeNotifications();
      const res = makeRes();

      await POST(makeReq(body, notifications, { emit: jest.fn() }), res as never);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(notifications.createTbankNotifications).not.toHaveBeenCalled();
    });
  });
});
