import { TBankApiError, TBankClient, type TBankResponse } from "../client";
import { generateToken } from "../token";
import type { TBankFiscalReceipt } from "../refund-receipt";

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
        receipt: {
          Email: "buyer@example.com",
          Taxation: "usn_income",
          Items: [{
            Name: "Футболка",
            Price: 1899000,
            Quantity: 1,
            Amount: 1899000,
            Tax: "vat105",
            PaymentMethod: "full_prepayment",
            PaymentObject: "commodity",
            MeasurementUnit: "шт",
          }],
        },
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
      expect(body.Receipt).toEqual({
        FfdVersion: "1.2",
        Email: "buyer@example.com",
        Taxation: "usn_income",
        Items: [{
          Name: "Футболка",
          Price: 1899000,
          Quantity: 1,
          Amount: 1899000,
          Tax: "vat105",
          PaymentMethod: "full_prepayment",
          PaymentObject: "commodity",
          MeasurementUnit: "шт",
        }],
      });
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

    const refundReceipt = Object.freeze<TBankFiscalReceipt>({
      Email: "buyer@example.com",
      Taxation: "usn_income",
      Items: [{
        Name: "Платье", Price: 333, Quantity: 1, Amount: 333, Tax: "vat105",
        PaymentMethod: "full_prepayment", PaymentObject: "commodity", MeasurementUnit: "шт",
      }],
    });
    const refundIds = { paymentId: "555", externalRequestId: "4dc3a25818d1f6db13586e31c05eab", merchRefundId: "refund_001" };
    const cancelSuccess = {
      Success: true, ErrorCode: "0", TerminalKey: CREDENTIALS.terminalKey, PaymentId: "555",
      OrderId: "order_001", Status: "PARTIAL_REFUNDED", OriginalAmount: 1000, NewAmount: 667,
      ExternalRequestId: refundIds.externalRequestId,
    };

    it("sends partial refund positions and stable signed correlation identifiers", async () => {
      const fetchMock = mockFetch({ json: async () => cancelSuccess });
      const client = new TBankClient(CREDENTIALS);
      const params = { ...refundIds, amountKopecks: 333, receipt: refundReceipt };
      const result = await client.cancel(params);
      await client.cancel(params);
      expect(result.OriginalAmount - result.NewAmount).toBe(333);
      const [url, options] = fetchMock.mock.calls[0];
      expect(url).toBe("https://securepay.tinkoff.ru/v2/Cancel");
      const body = JSON.parse(options.body as string);
      expect(body).toEqual({
        TerminalKey: CREDENTIALS.terminalKey, PaymentId: "555", Amount: 333,
        ExternalRequestId: refundIds.externalRequestId, DATA: { MerchRefundId: refundIds.merchRefundId },
        Receipt: { ...refundReceipt, FfdVersion: "1.2" }, Token: expect.any(String),
      });
      expect(body.Token).toBe(generateToken(body, CREDENTIALS.password));
      expect(fetchMock.mock.calls[1][1].body).toBe(options.body);
    });

    it("omits Receipt and Amount on a complete refund", async () => {
      const fetchMock = mockFetch({ json: async () => ({ ...cancelSuccess, Status: "REFUNDED", NewAmount: 0 }) });
      await new TBankClient(CREDENTIALS).cancel(refundIds);
      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
      expect(body).not.toHaveProperty("Receipt");
      expect(body).not.toHaveProperty("Amount");
      expect(body.ExternalRequestId).toBe(refundIds.externalRequestId);
    });

    it.each([
      { externalRequestId: "" }, { externalRequestId: "X".repeat(256) }, { merchRefundId: "" }, { merchRefundId: "X".repeat(101) },
      { amountKopecks: 0 }, { amountKopecks: 1.5 },
      { amountKopecks: 332, receipt: refundReceipt },
      { receipt: refundReceipt },
    ])("rejects unsafe refund request without contacting bank %j", async (changes) => {
      const fetchMock = mockFetch({ json: async () => cancelSuccess });
      await expect(new TBankClient(CREDENTIALS).cancel({ ...refundIds, ...changes })).rejects.toMatchObject({ errorCode: "INVALID_REQUEST" });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it.each([
      { PaymentId: "another" }, { TerminalKey: "another" }, { OriginalAmount: undefined },
      { NewAmount: -1 }, { NewAmount: 1001 }, { NewAmount: 1.5 },
      { ExternalRequestId: "another" }, { Status: undefined }, { OrderId: undefined },
      { ErrorCode: "999" },
    ])("marks uncorrelatable success as unknown rather than trustworthy refund proof %j", async (changes) => {
      mockFetch({ json: async () => ({ ...cancelSuccess, ...changes }) });
      await expect(new TBankClient(CREDENTIALS).cancel(refundIds)).rejects.toMatchObject({ errorCode: "BAD_RESPONSE" });
    });

    it("posts signed closing receipt to documented cashbox path without invented fields", async () => {
      const fetchMock = mockFetch({ json: async () => ({ Success: true, ErrorCode: "0" }) });
      const receipt: TBankFiscalReceipt = {
        ...refundReceipt,
        Items: [{ ...refundReceipt.Items[0], PaymentMethod: "full_payment", Tax: "vat5" }],
        Payments: { Electronic: 0, AdvancePayment: 333 },
      };
      await new TBankClient(CREDENTIALS).sendClosingReceipt({ paymentId: "555", receipt });
      const [url, options] = fetchMock.mock.calls[0];
      expect(url).toBe("https://securepay.tinkoff.ru/cashbox/SendClosingReceipt");
      expect(options.redirect).toBe("error");
      const body = JSON.parse(options.body as string);
      expect(Object.keys(body).sort()).toEqual(["PaymentId", "Receipt", "TerminalKey", "Token"]);
      expect(body.Receipt).toEqual({ ...receipt, FfdVersion: "1.2" });
      expect(body.Token).toBe(generateToken(body, CREDENTIALS.password));
    });

    it.each([
      "https://rest-api-test.tinkoff.ru/v2", "https://evil.example/v2",
      "http://securepay.tinkoff.ru/v2", "https://securepay.tinkoff.ru.evil.example/v2",
      "https://securepay.tinkoff.ru/v2/../v2",
    ])("never sends closing requests to an undocumented endpoint or redirects test keys %s", async (apiBaseUrl) => {
      const fetchMock = mockFetch({ json: async () => ({ Success: true, ErrorCode: "0" }) });
      await expect(new TBankClient({ ...CREDENTIALS, apiBaseUrl }).sendClosingReceipt({ paymentId: "555", receipt: refundReceipt }))
        .rejects.toMatchObject({ errorCode: "API_BASE_URL" });
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
});
