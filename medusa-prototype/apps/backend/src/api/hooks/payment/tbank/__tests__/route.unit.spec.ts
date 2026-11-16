import { POST } from "../route";
import { canonicalNotificationHash } from "../../../../../modules/tbank-notifications/lifecycle";
import { generateToken } from "../../../../../modules/tbank/lib/token";
import { parseAuthenticatedFiscalReceipt } from "../../../../../modules/tbank-notifications/fiscal";

const PASSWORD = "TinkoffBankTest";
const TERMINAL = "TinkoffBankTest";
const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };

const SESSION = {
  id: "payses_01JABCDEF",
  provider_id: "pp_tbank_tbank",
  currency_code: "rub",
  amount: 18990,
  status: "pending_authorization",
  data: { paymentId: "3456789", orderId: "payses_01JABCDEF", status: "NEW" },
};

function signed(overrides: Readonly<Record<string, unknown>> = {}) {
  const body: Record<string, unknown> = {
    TerminalKey: TERMINAL,
    OrderId: SESSION.id,
    PaymentId: 3456789,
    Status: "CONFIRMED",
    Amount: 1899000,
    Success: true,
    ...overrides,
  };
  body.Token = generateToken(body, PASSWORD);
  return body;
}

function makeNotifications(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    listTbankNotifications: jest.fn().mockResolvedValue([]),
    createTbankNotifications: jest.fn().mockResolvedValue({ id: "tbnotif_1" }),
    createTbankNotificationConflicts: jest.fn().mockResolvedValue({ id: "tbconf_1" }),
    listTbankFiscalReceipts: jest.fn().mockResolvedValue([]),
    createTbankFiscalReceipts: jest.fn().mockImplementation(async (input) => ({ id: "tbfiscal_1", ...input })),
    quarantineFiscalReceipt: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function makePayment(overrides: Readonly<Record<string, unknown>> = {}) {
  return { retrievePaymentSession: jest.fn().mockResolvedValue(SESSION), ...overrides };
}

function makeReq(
  body: Record<string, unknown>,
  notifications: ReturnType<typeof makeNotifications>,
  payment: ReturnType<typeof makePayment>,
  eventBus = { emit: jest.fn() },
) {
  return {
    body,
    scope: {
      resolve: (key: string) => {
        if (key === "logger") return logger;
        if (key === "tbankNotification") return notifications;
        if (key === "payment") return payment;
        return eventBus;
      },
    },
  } as never;
}

function makeRes() {
  const result: { statusCode: number; body?: unknown; status: jest.Mock; send: jest.Mock } = {
    statusCode: 200,
    status: jest.fn(),
    send: jest.fn(),
  };
  result.status.mockImplementation((statusCode: number) => {
    result.statusCode = statusCode;
    return result;
  });
  result.send.mockImplementation((body: unknown) => {
    result.body = body;
    return result;
  });
  return result;
}

beforeEach(() => {
  jest.clearAllMocks();
  Object.assign(process.env, {
    TBANK_ENABLED: "true",
    TBANK_PAYMENT_PROVIDER_ID: "pp_tbank_tbank",
    TBANK_TERMINAL_KEY: TERMINAL,
    TBANK_PASSWORD: PASSWORD,
    TBANK_RECEIPT_SNAPSHOT_SECRET: "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=",
    TBANK_API_BASE_URL: "https://rest-api-test.tinkoff.ru/v2",
    TBANK_SUCCESS_URL: "https://mariomikke.shop/checkout/success",
    TBANK_FAIL_URL: "https://mariomikke.shop/checkout/fail",
    TBANK_NOTIFICATION_URL: "https://api.mariomikke.shop/hooks/payment/tbank",
  });
});

describe("T-Bank authenticated webhook inbox", () => {
  it("creates zero rows and events when the signature is invalid", async () => {
    const notifications = makeNotifications();
    const payment = makePayment();
    const eventBus = { emit: jest.fn() };
    const response = makeRes();

    await POST(makeReq({ ...signed(), Token: "invalid" }, notifications, payment, eventBus), response as never);

    expect(response.statusCode).toBe(401);
    expect(response.body).not.toBe("OK");
    expect(notifications.listTbankNotifications).not.toHaveBeenCalled();
    expect(notifications.createTbankNotifications).not.toHaveBeenCalled();
    expect(notifications.createTbankNotificationConflicts).not.toHaveBeenCalled();
    expect(payment.retrievePaymentSession).not.toHaveBeenCalled();
    expect(eventBus.emit).not.toHaveBeenCalled();
  });

  it("accelerates processing only after persisting the correlated inbox fact", async () => {
    const notifications = makeNotifications();
    const payment = makePayment();
    const order: string[] = [];
    notifications.createTbankNotifications.mockImplementation(async () => {
      order.push("journal");
      return { id: "tbnotif_1" };
    });
    const eventBus = {
      emit: jest.fn(async () => {
        order.push("event");
      }),
    };
    const body = signed();
    const response = makeRes();

    await POST(makeReq(body, notifications, payment, eventBus), response as never);

    expect(notifications.createTbankNotifications).toHaveBeenCalledWith(expect.objectContaining({
      terminal_key: TERMINAL,
      payment_id: "3456789",
      order_id: SESSION.id,
      amount_kopecks: 1899000,
      currency_code: "rub",
      success: true,
      status: "CONFIRMED",
      lifecycle_state: "pending",
      canonical_payload_hash: canonicalNotificationHash(body),
      attempt_count: 0,
    }));
    expect(eventBus.emit).toHaveBeenCalledWith({
      name: "tbank.notification.received",
      data: { id: "tbnotif_1" },
    });
    expect(order).toEqual(["journal", "event"]);
    expect(response.body).toBe("OK");
  });

  it.each(["CANCELED", "REJECTED"])("persists omitted Amount for %s without inventing bank evidence", async (status) => {
    const notifications = makeNotifications();
    const response = makeRes();
    await POST(makeReq(signed({ Status: status, Success: false, Amount: undefined }), notifications, makePayment()), response as never);
    expect(notifications.createTbankNotifications).toHaveBeenCalledWith(expect.objectContaining({
      status, amount_kopecks: 0, amount_provided: false,
    }));
    expect(response.body).toBe("OK");
  });

  it("retains a signed callback awaiting correlation when its session is missing", async () => {
    const notifications = makeNotifications();
    const payment = makePayment({ retrievePaymentSession: jest.fn().mockRejectedValue(new Error("not found")) });

    await POST(makeReq(signed(), notifications, payment), makeRes() as never);

    expect(notifications.createTbankNotifications).toHaveBeenCalledWith(
      expect.objectContaining({ lifecycle_state: "awaiting_correlation" }),
    );
    expect(notifications.createTbankNotificationConflicts).not.toHaveBeenCalled();
  });

  it("persists reordered AUTHORIZED and CONFIRMED callbacks and accelerates both", async () => {
    const notifications = makeNotifications();
    const eventBus = { emit: jest.fn() };

    await POST(makeReq(signed({ Status: "AUTHORIZED" }), notifications, makePayment(), eventBus), makeRes() as never);
    await POST(makeReq(signed({ Status: "CONFIRMED" }), notifications, makePayment(), eventBus), makeRes() as never);

    expect(notifications.createTbankNotifications).toHaveBeenCalledTimes(2);
    expect(notifications.createTbankNotifications).toHaveBeenNthCalledWith(
      1, expect.objectContaining({ status: "AUTHORIZED", lifecycle_state: "pending" }),
    );
    expect(notifications.createTbankNotifications).toHaveBeenNthCalledWith(
      2, expect.objectContaining({ status: "CONFIRMED", lifecycle_state: "pending" }),
    );
    expect(eventBus.emit).toHaveBeenCalledTimes(2);
  });

  it("durably quarantines a malformed authenticated callback", async () => {
    const body: Record<string, unknown> = { TerminalKey: TERMINAL };
    body.Token = generateToken(body, PASSWORD);
    const notifications = makeNotifications();
    const response = makeRes();

    await POST(makeReq(body, notifications, makePayment()), response as never);

    expect(notifications.createTbankNotificationConflicts).toHaveBeenCalledWith(
      expect.objectContaining({ conflict_kind: "malformed_authenticated", lifecycle_state: "manual_review" }),
    );
    expect(notifications.createTbankNotifications).not.toHaveBeenCalled();
    expect(response.body).toBe("OK");
  });

  it.each([
    ["terminal", { TerminalKey: "OtherTerminal" }, SESSION],
    ["provider", {}, { ...SESSION, provider_id: "pp_other_other" }],
    ["PaymentId", {}, { ...SESSION, data: { ...SESSION.data, paymentId: "999" } }],
    ["OrderId", {}, { ...SESSION, id: "payses_other" }],
    ["amount", {}, { ...SESSION, amount: 1 }],
    ["currency", {}, { ...SESSION, currency_code: "usd" }],
    ["Success/status", { Success: false }, SESSION],
    ["unknown status", { Status: "SURPRISE" }, SESSION],
  ])("audits and quarantines a definite %s mismatch without consuming dedupe", async (_name, bodyOverride, session) => {
    const notifications = makeNotifications();
    const payment = makePayment({ retrievePaymentSession: jest.fn().mockResolvedValue(session) });

    await POST(makeReq(signed(bodyOverride), notifications, payment), makeRes() as never);

    expect(notifications.createTbankNotifications).not.toHaveBeenCalled();
    expect(notifications.createTbankNotificationConflicts).toHaveBeenCalledWith(
      expect.objectContaining({ lifecycle_state: "manual_review" }),
    );
  });

  it("does not consume dedupe when mismatch quarantine cannot be persisted", async () => {
    const notifications = makeNotifications({
      createTbankNotificationConflicts: jest.fn().mockRejectedValue(new Error("db down")),
    });
    const response = makeRes();

    await POST(
      makeReq(signed(), notifications, makePayment({ retrievePaymentSession: jest.fn().mockResolvedValue({ ...SESSION, amount: 1 }) })),
      response as never,
    );

    expect(response.statusCode).toBe(500);
    expect(response.body).not.toBe("OK");
    expect(notifications.createTbankNotifications).not.toHaveBeenCalled();
  });

  it("acknowledges an identical authenticated duplicate as one inbox fact", async () => {
    const body = signed();
    const notifications = makeNotifications({
      listTbankNotifications: jest.fn().mockResolvedValue([{ canonical_payload_hash: canonicalNotificationHash(body) }]),
    });

    const response = makeRes();
    await POST(makeReq(body, notifications, makePayment()), response as never);

    expect(response.body).toBe("OK");
    expect(notifications.createTbankNotifications).not.toHaveBeenCalled();
    expect(notifications.createTbankNotificationConflicts).not.toHaveBeenCalled();
  });

  it("audits a changed canonical duplicate as a security conflict", async () => {
    const notifications = makeNotifications({
      listTbankNotifications: jest.fn().mockResolvedValue([{ id: "tbnotif_1", canonical_payload_hash: "old" }]),
    });

    await POST(makeReq(signed(), notifications, makePayment()), makeRes() as never);

    expect(notifications.createTbankNotifications).not.toHaveBeenCalled();
    expect(notifications.createTbankNotificationConflicts).toHaveBeenCalledWith(
      expect.objectContaining({ canonical_notification_id: "tbnotif_1", conflict_kind: "canonical_payload_changed" }),
    );
  });

  it("does not return OK when an authenticated fact cannot be persisted", async () => {
    const notifications = makeNotifications({ createTbankNotifications: jest.fn().mockRejectedValue(new Error("db down")) });
    const response = makeRes();

    await POST(makeReq(signed(), notifications, makePayment()), response as never);

    expect(response.statusCode).toBe(500);
    expect(response.body).not.toBe("OK");
  });
});

describe("T-Bank fiscal receipt webhook", () => {
  const fiscal = {
    Status: "RECEIPT",
    Type: "income",
    ErrorCode: "0",
    FnNumber: "9999078900000001",
    FiscalDocumentNumber: 123,
    FiscalDocumentAttribute: 456,
    ReceiptDatetime: "2026-11-18T10:00:00",
    FiscalNumber: 12,
    ShiftNumber: 3,
    EcrRegNumber: "0000000000000001",
  };

  it("has zero fiscal side effects for an invalid signature", async () => {
    const notifications = makeNotifications();
    const eventBus = { emit: jest.fn() };
    const payment = makePayment();
    const response = makeRes();
    await POST(makeReq({ ...signed(fiscal), Token: "invalid" }, notifications, payment, eventBus), response as never);
    expect(response.statusCode).toBe(401);
    expect(notifications.listTbankFiscalReceipts).not.toHaveBeenCalled();
    expect(notifications.createTbankFiscalReceipts).not.toHaveBeenCalled();
    expect(notifications.createTbankNotificationConflicts).not.toHaveBeenCalled();
    expect(payment.retrievePaymentSession).not.toHaveBeenCalled();
    expect(eventBus.emit).not.toHaveBeenCalled();
  });

  it("rejects another signed terminal before any fiscal inbox access", async () => {
    const notifications = makeNotifications();
    const response = makeRes();
    await POST(makeReq(signed({ ...fiscal, TerminalKey: "other" }), notifications, makePayment()), response as never);
    expect(response.statusCode).toBe(401);
    expect(notifications.listTbankFiscalReceipts).not.toHaveBeenCalled();
    expect(notifications.createTbankNotificationConflicts).not.toHaveBeenCalled();
  });

  it("durably defers out-of-order fiscal facts without payment/capture processing", async () => {
    const notifications = makeNotifications();
    const payment = makePayment();
    const eventBus = { emit: jest.fn() };
    const response = makeRes();
    await POST(makeReq(signed(fiscal), notifications, payment, eventBus), response as never);
    expect(notifications.createTbankFiscalReceipts).toHaveBeenCalledWith(expect.objectContaining({
      payment_id: "3456789", order_id: SESSION.id, amount_kopecks: 1899000,
      receipt_type: "income", success: true, lifecycle_state: "awaiting_correlation",
      fiscal_document_number: "123", fiscal_document_attribute: "456",
      fiscal_number: "12", shift_number: "3", ecr_reg_number: "0000000000000001",
    }));
    expect(notifications.createTbankNotifications).not.toHaveBeenCalled();
    expect(payment.retrievePaymentSession).not.toHaveBeenCalled();
    expect(eventBus.emit).toHaveBeenCalledWith({ name: "tbank.fiscal.received", data: { id: "tbfiscal_1" } });
    expect(response.body).toBe("OK");
  });

  it("does not deduplicate distinct fiscal documents for one payment", async () => {
    const notifications = makeNotifications();
    await POST(makeReq(signed(fiscal), notifications, makePayment()), makeRes() as never);
    await POST(makeReq(signed({ ...fiscal, FiscalDocumentNumber: 124 }), notifications, makePayment()), makeRes() as never);
    const [first, second] = notifications.createTbankFiscalReceipts.mock.calls.map(([row]) => row.receipt_key);
    expect(first).not.toBe(second);
    expect(notifications.createTbankFiscalReceipts).toHaveBeenCalledTimes(2);
  });

  it("acknowledges an identical document without recreating it", async () => {
    const body = signed(fiscal);
    const row = { id: "tbfiscal_1", ...parseAuthenticatedFiscalReceipt(body) };
    const notifications = makeNotifications({ listTbankFiscalReceipts: jest.fn().mockResolvedValue([row]) });
    const response = makeRes();
    await POST(makeReq(body, notifications, makePayment()), response as never);
    expect(response.body).toBe("OK");
    expect(notifications.createTbankFiscalReceipts).not.toHaveBeenCalled();
    expect(notifications.createTbankNotificationConflicts).not.toHaveBeenCalled();
  });

  it("quarantines a conflicting signed document without fiscal application", async () => {
    const row = { id: "tbfiscal_1", ...parseAuthenticatedFiscalReceipt(signed(fiscal)) };
    const notifications = makeNotifications({ listTbankFiscalReceipts: jest.fn().mockResolvedValue([row]) });
    const eventBus = { emit: jest.fn() };
    await POST(makeReq(signed({ ...fiscal, Amount: 1 }), notifications, makePayment(), eventBus), makeRes() as never);
    expect(eventBus.emit).not.toHaveBeenCalled();
  });

  it("retains fiscal failures without inventing fiscal document identifiers", async () => {
    const notifications = makeNotifications();
    await POST(makeReq(signed({
      ...fiscal, Success: false, ErrorCode: "500",
      FnNumber: undefined, FiscalDocumentNumber: undefined, FiscalDocumentAttribute: undefined,
    }), notifications, makePayment()), makeRes() as never);
    expect(notifications.createTbankFiscalReceipts).toHaveBeenCalledWith(expect.objectContaining({
      success: false, error_code: "500", fn_number: null, fiscal_document_number: null,
      lifecycle_state: "awaiting_correlation",
    }));
  });

  it.each(["FnNumber", "FiscalDocumentNumber", "FiscalDocumentAttribute"])(
    "quarantines reported success missing %s", async (field) => {
      const notifications = makeNotifications();
      await POST(makeReq(signed({ ...fiscal, [field]: undefined }), notifications, makePayment()), makeRes() as never);
      expect(notifications.createTbankFiscalReceipts).not.toHaveBeenCalled();
      expect(notifications.createTbankNotificationConflicts).toHaveBeenCalledWith(expect.objectContaining({
        status: "RECEIPT", conflict_kind: "malformed_authenticated",
      }));
    },
  );

  it("ignores unsigned nested Receipt changes for fiscal identity and correlation", async () => {
    const original = signed({ ...fiscal, Receipt: { Items: [{ PaymentMethod: "prepayment" }] } });
    const changed = { ...original, Receipt: { Items: [{ PaymentMethod: "full_payment" }], Email: "injected@example.com" } };
    expect(parseAuthenticatedFiscalReceipt(changed)).toEqual(parseAuthenticatedFiscalReceipt(original));
    const notifications = makeNotifications();
    await POST(makeReq(changed, notifications, makePayment()), makeRes() as never);
    const stored = notifications.createTbankFiscalReceipts.mock.calls[0][0];
    expect(stored).not.toHaveProperty("Receipt");
    expect(stored).not.toHaveProperty("Email");
    expect(stored).not.toHaveProperty("Token");
  });

  it("does not ACK a fiscal fact when durable persistence fails", async () => {
    const notifications = makeNotifications({
      createTbankFiscalReceipts: jest.fn().mockRejectedValue(new Error("db unavailable")),
    });
    const response = makeRes();
    const eventBus = { emit: jest.fn() };
    await POST(makeReq(signed(fiscal), notifications, makePayment(), eventBus), response as never);
    expect(response.statusCode).toBe(500);
    expect(response.body).not.toBe("OK");
    expect(eventBus.emit).not.toHaveBeenCalled();
  });
});
