import { TBankApiError, TBankClient, type TBankResponse } from "../client";
import { generateToken } from "../token";

const CREDENTIALS = {
  terminalKey: "TestTerminal123",
  password: "TestPassword456",
  apiBaseUrl: "https://securepay.tinkoff.ru/v2",
};

describe("TBankClient", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.clearAllMocks();
  });

  function mockFetch(response: {
    ok?: boolean;
    status?: number;
    json?: () => Promise<unknown>;
    text?: () => Promise<string>;
  }) {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: response.ok ?? true,
      status: response.status ?? 200,
      json: response.json ?? (async () => ({})),
      text: response.text ?? (async () => ""),
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    return fetchMock;
  }

  describe("call / signing & transport", () => {
    it("подставляет TerminalKey и вычисляет корректный Token", async () => {
      const fetchMock = mockFetch({
        json: async () => ({ Success: true, ErrorCode: "0", PaymentId: "123" }),
      });

      const client = new TBankClient(CREDENTIALS);
      await client.call("Init", { OrderId: "payses_001", Amount: 10000 });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, options] = fetchMock.mock.calls[0];
      expect(url).toBe("https://securepay.tinkoff.ru/v2/Init");
      expect(options.method).toBe("POST");
      expect(options.headers).toEqual({ "Content-Type": "application/json" });

      const parsedBody = JSON.parse(options.body as string);
      expect(parsedBody.TerminalKey).toBe("TestTerminal123");
      expect(parsedBody.OrderId).toBe("payses_001");
      expect(parsedBody.Amount).toBe(10000);

      const expectedToken = generateToken(
        { TerminalKey: "TestTerminal123", OrderId: "payses_001", Amount: 10000 },
        CREDENTIALS.password,
      );
      expect(parsedBody.Token).toBe(expectedToken);
    });

    it("выбрасывает TBankApiError с кодом TIMEOUT при срабатывании таймаута", async () => {
      const abortError = new Error("The operation was aborted");
      abortError.name = "AbortError";
      global.fetch = jest.fn().mockRejectedValue(abortError);

      const client = new TBankClient(CREDENTIALS, 50);

      await expect(client.call("Init", { OrderId: "order_timeout" })).rejects.toThrow(
        TBankApiError,
      );
      await expect(client.call("Init", { OrderId: "order_timeout" })).rejects.toMatchObject({
        errorCode: "TIMEOUT",
        method: "Init",
      });
    });

    it("выбрасывает TBankApiError с кодом NETWORK при сбое соединения", async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error("connect ECONNREFUSED 127.0.0.1:443"));

      const client = new TBankClient(CREDENTIALS);

      await expect(client.call("GetState", { PaymentId: "123" })).rejects.toThrow(
        TBankApiError,
      );
      await expect(client.call("GetState", { PaymentId: "123" })).rejects.toMatchObject({
        errorCode: "NETWORK",
        method: "GetState",
      });
    });

    it("выбрасывает TBankApiError с кодом HTTP_* при статусе != 2xx", async () => {
      mockFetch({
        ok: false,
        status: 502,
        json: async () => ({}),
      });

      const client = new TBankClient(CREDENTIALS);

      await expect(client.call("Init", { OrderId: "order_502" })).rejects.toMatchObject({
        errorCode: "HTTP_502",
        method: "Init",
      });
    });

    it("выбрасывает TBankApiError с кодом BAD_JSON при неразбираемом теле", async () => {
      const fetchMock = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => {
          throw new SyntaxError("Unexpected token < in JSON");
        },
      });
      global.fetch = fetchMock as unknown as typeof fetch;

      const client = new TBankClient(CREDENTIALS);

      await expect(client.call("Init", { OrderId: "order_bad_json" })).rejects.toMatchObject({
        errorCode: "BAD_JSON",
        method: "Init",
      });
    });

    it("выбрасывает TBankApiError с кодом банка, если Success === false", async () => {
      mockFetch({
        ok: true,
        status: 200,
        json: async () => ({
          Success: false,
          ErrorCode: "1051",
          Message: "Недостаточно средств на карте",
          Details: "Card limit exceeded",
        }),
      });

      const client = new TBankClient(CREDENTIALS);

      await expect(client.call("Init", { OrderId: "order_fail" })).rejects.toMatchObject({
        errorCode: "1051",
        method: "Init",
        message: expect.stringContaining("1051"),
        details: "Card limit exceeded",
      });
    });

    it("возвращает результат при Success === true", async () => {
      mockFetch({
        ok: true,
        status: 200,
        json: async () => ({
          Success: true,
          ErrorCode: "0",
          PaymentId: "987654",
          Status: "NEW",
          PaymentURL: "https://securepay.tinkoff.ru/v2/payment/987654",
        }),
      });

      const client = new TBankClient(CREDENTIALS);
      const result = await client.call<TBankResponse & { PaymentId: string; Status: string }>("Init", {
        OrderId: "order_ok",
      });

      expect(result.PaymentId).toBe("987654");
      expect(result.Status).toBe("NEW");
    });
  });

  describe("API methods", () => {
    it("init формирует правильные параметры с PayType=O", async () => {
      const fetchMock = mockFetch({
        json: async () => ({
          Success: true,
          ErrorCode: "0",
          PaymentId: "555",
          PaymentURL: "https://securepay.tinkoff.ru/pay",
          Status: "NEW",
        }),
      });

      const client = new TBankClient(CREDENTIALS);
      const result = await client.init({
        orderId: "payses_002",
        amountKopecks: 1899000,
        description: "Заказ 002",
        successUrl: "https://mariomikke.ru/success",
        failUrl: "https://mariomikke.ru/fail",
        notificationUrl: "https://mariomikke.ru/webhook",
        receipt: { Items: [] },
        data: { test: "value" },
      });

      expect(result.PaymentId).toBe("555");
      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
      expect(body.Amount).toBe(1899000);
      expect(body.OrderId).toBe("payses_002");
      expect(body.PayType).toBe("O");
      expect(body.Description).toBe("Заказ 002");
      expect(body.SuccessURL).toBe("https://mariomikke.ru/success");
      expect(body.FailURL).toBe("https://mariomikke.ru/fail");
      expect(body.NotificationURL).toBe("https://mariomikke.ru/webhook");
      expect(body.Receipt).toEqual({ Items: [] });
      expect(body.DATA).toEqual({ test: "value" });
    });

    it("getState передаёт PaymentId", async () => {
      const fetchMock = mockFetch({
        json: async () => ({
          Success: true,
          ErrorCode: "0",
          PaymentId: "555",
          Status: "CONFIRMED",
        }),
      });

      const client = new TBankClient(CREDENTIALS);
      const result = await client.getState("555");

      expect(result.Status).toBe("CONFIRMED");
      const [url, options] = fetchMock.mock.calls[0];
      expect(url).toBe("https://securepay.tinkoff.ru/v2/GetState");
      const body = JSON.parse(options.body as string);
      expect(body.PaymentId).toBe("555");
    });

    it("checkOrder передаёт OrderId", async () => {
      const fetchMock = mockFetch({
        json: async () => ({
          Success: true,
          ErrorCode: "0",
          OrderId: "payses_003",
          Status: "CONFIRMED",
          Payments: [{ PaymentId: "777", Amount: 50000, Status: "CONFIRMED" }],
        }),
      });

      const client = new TBankClient(CREDENTIALS);
      const result = await client.checkOrder("payses_003");

      expect(result.Payments?.[0]?.PaymentId).toBe("777");
      const [url, options] = fetchMock.mock.calls[0];
      expect(url).toBe("https://securepay.tinkoff.ru/v2/CheckOrder");
      const body = JSON.parse(options.body as string);
      expect(body.OrderId).toBe("payses_003");
    });

    it("cancel передаёт PaymentId и Amount", async () => {
      const fetchMock = mockFetch({
        json: async () => ({
          Success: true,
          ErrorCode: "0",
          PaymentId: "555",
          Status: "CANCELED",
        }),
      });

      const client = new TBankClient(CREDENTIALS);
      const result = await client.cancel({
        paymentId: "555",
        amountKopecks: 10000,
        receipt: { Items: [] },
      });

      expect(result.Success).toBe(true);
      const [url, options] = fetchMock.mock.calls[0];
      expect(url).toBe("https://securepay.tinkoff.ru/v2/Cancel");
      const body = JSON.parse(options.body as string);
      expect(body.PaymentId).toBe("555");
      expect(body.Amount).toBe(10000);
      expect(body.Receipt).toEqual({ Items: [] });
    });
  });
});
