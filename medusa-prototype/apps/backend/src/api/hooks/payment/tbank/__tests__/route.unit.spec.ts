import { POST } from "../route";
import { canonicalNotificationHash } from "../../../../../modules/tbank-notifications/lifecycle";
import { generateToken } from "../../../../../modules/tbank/lib/token";
import { fiscalFingerprint } from "../../../../../modules/tbank-notifications/fiscal";

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
const CAPTURED_SESSION = { ...SESSION, status: "captured" };

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
    listTbankFiscalNotifications: jest.fn().mockResolvedValue([]),
    createTbankFiscalNotifications: jest.fn().mockResolvedValue({ id: "tbfiscal_1" }),
    createTbankNotifications: jest.fn().mockResolvedValue({ id: "tbnotif_1" }),
    createTbankNotificationConflicts: jest.fn().mockResolvedValue({ id: "tbconf_1" }),
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
    const body: Record<string, unknown> = { TerminalKey: TERMINAL, Status: "CONFIRMED" };
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

describe("T-Bank fiscal callbacks on the shared webhook", () => {
  it("persists the signed fiscal error without payment inbox writes or events", async () => {
    const notifications = makeNotifications();
    const payment = makePayment();
    const eventBus = { emit: jest.fn() };
    const body = signed({
      Status: "RECEIPT_FAILED",
      Success: false,
      ErrorCode: "205",
      ErrorMessage: "Customer address: 27 Main Street, Jane Doe",
      Type: "sell",
      FnNumber: "12345",
      FiscalDocumentNumber: "456",
      Receipt: { Email: "customer@example.com", PAN: "1234567890123456" },
    });
    const response = makeRes();
    await POST(makeReq(body, notifications, payment, eventBus), response as never);

    expect(response.body).toBe("OK");
    expect(notifications.createTbankFiscalNotifications).toHaveBeenCalledWith(expect.objectContaining({
      fingerprint: fiscalFingerprint(body),
      terminal_key: TERMINAL,
      payment_id: "3456789",
      order_id: SESSION.id,
      status: "RECEIPT_FAILED",
      receipt_type: "sell",
      error_code: "205",
      fn_number: "12345",
      fiscal_document_number: "456",
      review_state: "manual_review",
    }));
    expect(JSON.stringify(notifications.createTbankFiscalNotifications.mock.calls)).not.toContain("Jane Doe");
    expect(JSON.stringify(notifications.createTbankFiscalNotifications.mock.calls)).not.toContain("customer@example.com");
    expect(JSON.stringify(notifications.createTbankFiscalNotifications.mock.calls)).not.toContain("1234567890123456");
    expect(notifications.createTbankNotifications).not.toHaveBeenCalled();
    expect(notifications.createTbankNotificationConflicts).not.toHaveBeenCalled();
    expect(eventBus.emit).not.toHaveBeenCalled();
  });

  it("rejects an invalid fiscal signature without any writes or session lookup", async () => {
    const notifications = makeNotifications();
    const payment = makePayment();
    const eventBus = { emit: jest.fn() };
    const response = makeRes();
    await POST(makeReq({ ...signed({ ErrorMessage: "failed" }), Token: "invalid" }, notifications, payment, eventBus), response as never);
    expect(response.statusCode).toBe(401);
    expect(notifications.listTbankFiscalNotifications).not.toHaveBeenCalled();
    expect(notifications.createTbankFiscalNotifications).not.toHaveBeenCalled();
    expect(notifications.createTbankNotifications).not.toHaveBeenCalled();
    expect(payment.retrievePaymentSession).not.toHaveBeenCalled();
    expect(eventBus.emit).not.toHaveBeenCalled();
  });

  it("retains an unknown payment status for review without creating a payment event", async () => {
    const notifications = makeNotifications();
    const eventBus = { emit: jest.fn() };
    await POST(makeReq(signed({ Status: "SURPRISE" }), notifications, makePayment(), eventBus), makeRes() as never);
    expect(notifications.createTbankFiscalNotifications).toHaveBeenCalledWith(
      expect.objectContaining({ review_state: "manual_review", review_reason: expect.stringContaining("ambiguous_notification_type") }),
    );
    expect(notifications.createTbankNotifications).not.toHaveBeenCalled();
    expect(eventBus.emit).not.toHaveBeenCalled();
  });

  it.each([
    ["Receipt", { Receipt: { Email: "nested@example.com" } }],
    ["Type", { Type: { fake: "sell" } }],
  ])("cannot divert a signed payment notification using unsigned nested %s", async (_name, extra) => {
    const notifications = makeNotifications();
    const eventBus = { emit: jest.fn() };
    await POST(makeReq({ ...signed(), ...extra }, notifications, makePayment(), eventBus), makeRes() as never);
    expect(notifications.createTbankFiscalNotifications).not.toHaveBeenCalled();
    expect(notifications.createTbankNotifications).toHaveBeenCalledWith(
      expect.objectContaining({ status: "CONFIRMED" }),
    );
    expect(eventBus.emit).toHaveBeenCalledTimes(1);
  });

  it("keeps a signed rejected payment with an ErrorMessage in the payment inbox", async () => {
    const notifications = makeNotifications();
    const body = signed({ Status: "REJECTED", Success: false, ErrorCode: "205", ErrorMessage: "Payment rejected" });
    await POST(makeReq(body, notifications, makePayment()), makeRes() as never);
    expect(notifications.createTbankNotifications).toHaveBeenCalledWith(
      expect.objectContaining({ status: "REJECTED" }),
    );
    expect(notifications.createTbankFiscalNotifications).not.toHaveBeenCalled();
  });

  it("routes signed fiscal-document markers even if the bank uses a payment-shaped status", async () => {
    const notifications = makeNotifications();
    const eventBus = { emit: jest.fn() };
    await POST(makeReq(signed({ FiscalNumber: 42, ErrorCode: "0" }), notifications,
      makePayment({ retrievePaymentSession: jest.fn().mockResolvedValue(CAPTURED_SESSION) }), eventBus), makeRes() as never);
    expect(notifications.createTbankFiscalNotifications).toHaveBeenCalledWith(
      expect.objectContaining({ review_state: "observed" }),
    );
    expect(notifications.createTbankNotifications).not.toHaveBeenCalled();
    expect(eventBus.emit).not.toHaveBeenCalled();
  });

  it("marks a zero-error signed fiscal signal observed only after full correlation", async () => {
    const notifications = makeNotifications();
    await POST(makeReq(signed({ Type: "sell", ErrorCode: "0" }), notifications,
      makePayment({ retrievePaymentSession: jest.fn().mockResolvedValue(CAPTURED_SESSION) })), makeRes() as never);
    expect(notifications.createTbankFiscalNotifications).toHaveBeenCalledWith(
      expect.objectContaining({ review_state: "observed", review_reason: null, amount_kopecks: 1899000 }),
    );
  });

  it.each([
    ["missing payment amount", { Amount: undefined }, "missing_amount"],
    ["negative payment amount", { Amount: -1 }, "invalid_amount"],
    ["unverified receipt status", { Status: "RECEIPT_FAILED" }, "status_unconfirmed"],
    ["bank error message despite zero code", { ErrorMessage: "OFD rejected the receipt" }, "fiscal_error_message"],
  ])("keeps %s in manual review after a captured payment", async (_name, fields, reason) => {
    const notifications = makeNotifications();
    await POST(makeReq(signed({ Type: "sell", ErrorCode: "0", ...fields }), notifications,
      makePayment({ retrievePaymentSession: jest.fn().mockResolvedValue(CAPTURED_SESSION) })), makeRes() as never);
    expect(notifications.createTbankFiscalNotifications).toHaveBeenCalledWith(
      expect.objectContaining({ review_state: "manual_review", review_reason: reason }),
    );
  });

  it("does not treat a fiscal callback as reconciled before the matching payment is captured", async () => {
    const notifications = makeNotifications();
    await POST(makeReq(signed({ Type: "sell", ErrorCode: "0" }), notifications, makePayment()), makeRes() as never);
    expect(notifications.createTbankFiscalNotifications).toHaveBeenCalledWith(
      expect.objectContaining({ review_state: "manual_review", review_reason: "payment_not_captured" }),
    );
  });

  it("keeps an explicitly unsuccessful zero-code fiscal notification in manual review", async () => {
    const notifications = makeNotifications();
    await POST(makeReq(signed({ Type: "sell", ErrorCode: "0", Success: false }), notifications,
      makePayment({ retrievePaymentSession: jest.fn().mockResolvedValue(CAPTURED_SESSION) })), makeRes() as never);
    expect(notifications.createTbankFiscalNotifications).toHaveBeenCalledWith(
      expect.objectContaining({ review_state: "manual_review", review_reason: "fiscal_failure" }),
    );
  });

  it("retains a signed fiscal callback from a different terminal for manual review", async () => {
    const notifications = makeNotifications();
    await POST(makeReq(signed({ Type: "sell", ErrorCode: "0", TerminalKey: "OtherTerminal" }), notifications,
      makePayment({ retrievePaymentSession: jest.fn().mockResolvedValue(CAPTURED_SESSION) })), makeRes() as never);
    expect(notifications.createTbankFiscalNotifications).toHaveBeenCalledWith(
      expect.objectContaining({ terminal_key: "OtherTerminal", review_state: "manual_review", review_reason: "terminal_mismatch" }),
    );
  });

  it.each([
    ["provider", { ...CAPTURED_SESSION, provider_id: "pp_other_other" }, "provider_mismatch"],
    ["payment", { ...CAPTURED_SESSION, data: { ...SESSION.data, paymentId: "other" } }, "payment_mismatch"],
    ["order", { ...CAPTURED_SESSION, data: { ...SESSION.data, orderId: "other" } }, "order_mismatch"],
    ["currency", { ...CAPTURED_SESSION, currency_code: "usd" }, "currency_mismatch"],
    ["amount", { ...CAPTURED_SESSION, amount: 1 }, "amount_mismatch"],
  ])("marks %s correlation mismatch for manual review", async (_field, session, reason) => {
    const notifications = makeNotifications();
    const payment = makePayment({ retrievePaymentSession: jest.fn().mockResolvedValue(session) });
    await POST(makeReq(signed({ Type: "sell", ErrorCode: "0" }), notifications, payment), makeRes() as never);
    expect(notifications.createTbankFiscalNotifications).toHaveBeenCalledWith(
      expect.objectContaining({ review_state: "manual_review", review_reason: reason }),
    );
    expect(notifications.createTbankNotifications).not.toHaveBeenCalled();
  });

  it("keeps missing identity and unavailable session visible for review", async () => {
    const notifications = makeNotifications();
    const payment = makePayment({ retrievePaymentSession: jest.fn().mockRejectedValue(new Error("missing session")) });
    await POST(makeReq(signed({ Type: "sell", ErrorCode: 0 }), notifications, payment), makeRes() as never);
    expect(notifications.createTbankFiscalNotifications).toHaveBeenCalledWith(
      expect.objectContaining({ review_reason: "session_unavailable", review_state: "manual_review" }),
    );
    await POST(makeReq(signed({ Type: "sell", ErrorCode: 0, OrderId: "" }), notifications, payment), makeRes() as never);
    expect(notifications.createTbankFiscalNotifications).toHaveBeenLastCalledWith(
      expect.objectContaining({ order_id: null, review_reason: "missing_order", review_state: "manual_review" }),
    );
  });

  it("does not persist customer details from the signed error diagnostic", async () => {
    const notifications = makeNotifications();
    await POST(makeReq(signed({ Type: "sell", ErrorMessage: "Please contact Jane Doe at 27 Main Street" }), notifications, makePayment()), makeRes() as never);
    const persisted = notifications.createTbankFiscalNotifications.mock.calls[0]?.[0];
    expect(persisted).toEqual(expect.objectContaining({ review_state: "manual_review", review_reason: expect.stringContaining("fiscal_error_message") }));
    expect(JSON.stringify(persisted)).not.toContain("Jane Doe");
    expect(JSON.stringify(persisted)).not.toContain("27 Main Street");
  });

  it("uses canonical signed scalar values for redelivery fingerprints", () => {
    const numeric = signed({ Type: "sell", ErrorCode: 0 });
    const strings = signed({ Type: "sell", ErrorCode: "0", Amount: "1899000", PaymentId: "3456789" });
    expect(fiscalFingerprint(numeric)).toBe(fiscalFingerprint(strings));
    expect(fiscalFingerprint({ ...numeric, Token: "different", Password: "secret", Receipt: { Email: "ignored@example.com" } }))
      .toBe(fiscalFingerprint(numeric));
    expect(fiscalFingerprint(signed({ Type: "sell", ErrorCode: 1 }))).not.toBe(fiscalFingerprint(numeric));
  });

  it("acknowledges a duplicate fingerprint without a second insert", async () => {
    const body = signed({ Type: "sell", ErrorMessage: "fiscal error" });
    const notifications = makeNotifications({
      listTbankFiscalNotifications: jest.fn().mockResolvedValue([{ fingerprint: fiscalFingerprint(body) }]),
    });
    const response = makeRes();
    await POST(makeReq(body, notifications, makePayment()), response as never);
    expect(response.body).toBe("OK");
    expect(notifications.createTbankFiscalNotifications).not.toHaveBeenCalled();
    expect(notifications.createTbankNotifications).not.toHaveBeenCalled();
  });

  it("acknowledges an insert uniqueness race only after finding its canonical row", async () => {
    const body = signed({ Type: "sell" });
    const notifications = makeNotifications({
      listTbankFiscalNotifications: jest.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([{ fingerprint: fiscalFingerprint(body) }]),
      createTbankFiscalNotifications: jest.fn().mockRejectedValue({ code: "23505" }),
    });
    const response = makeRes();
    await POST(makeReq(body, notifications, makePayment()), response as never);
    expect(response.body).toBe("OK");
    expect(notifications.listTbankFiscalNotifications).toHaveBeenCalledTimes(2);
  });

  it("returns a generic error without exposing fiscal diagnostic data when the journal cannot be read", async () => {
    const notifications = makeNotifications({
      listTbankFiscalNotifications: jest.fn().mockRejectedValue(new Error("Jane Doe lives at 27 Main Street")),
    });
    const response = makeRes();
    await POST(makeReq(signed({ Type: "sell", ErrorMessage: "Jane Doe lives at 27 Main Street" }), notifications, makePayment()), response as never);
    expect(response.statusCode).toBe(500);
    expect(response.body).toBe("failed to record fiscal notification");
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain("Jane Doe");
    expect(notifications.createTbankNotifications).not.toHaveBeenCalled();
    expect(notifications.createTbankFiscalNotifications).not.toHaveBeenCalled();
  });

  it("does not acknowledge an unrelated insert failure even if a matching row appears", async () => {
    const body = signed({ Type: "sell", ErrorMessage: "failure" });
    const notifications = makeNotifications({
      listTbankFiscalNotifications: jest.fn().mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ fingerprint: fiscalFingerprint(body) }]),
      createTbankFiscalNotifications: jest.fn().mockRejectedValue(new Error("unrelated failure")),
    });
    const response = makeRes();
    await POST(makeReq(body, notifications, makePayment()), response as never);
    expect(response.statusCode).toBe(500);
    expect(notifications.listTbankFiscalNotifications).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["database outage", new Error("db down"), []],
    ["missing canonical after race", { code: "23505" }, []],
  ])("returns 500 on %s so the bank can retry", async (_case, failure, canonical) => {
    const notifications = makeNotifications({
      listTbankFiscalNotifications: jest.fn().mockResolvedValue(canonical),
      createTbankFiscalNotifications: jest.fn().mockRejectedValue(failure),
    });
    const eventBus = { emit: jest.fn() };
    const response = makeRes();
    await POST(makeReq(signed({ Type: "sell", ErrorMessage: "failure" }), notifications, makePayment(), eventBus), response as never);
    expect(response.statusCode).toBe(500);
    expect(response.body).not.toBe("OK");
    expect(notifications.createTbankNotifications).not.toHaveBeenCalled();
    expect(eventBus.emit).not.toHaveBeenCalled();
  });
});
