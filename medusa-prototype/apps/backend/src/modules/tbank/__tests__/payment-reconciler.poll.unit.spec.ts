import type { PaymentSessionDTO } from "@medusajs/types";

import { PaymentReconcilerService } from "../services/payment-reconciler";
import type { PaymentAttemptPollRow } from "../services/reconciliation-contracts";

const ATTEMPT = {
  id: "tbatt_poll",
  payment_session_id: "payses_poll",
  provider_id: "pp_tbank_tbank",
  terminal_key: "term_poll",
  order_id: "payses_poll",
  expected_amount_kopecks: 50_000,
  currency_code: "rub",
} as const;

const SESSION: PaymentSessionDTO = {
  id: ATTEMPT.payment_session_id,
  provider_id: ATTEMPT.provider_id,
  amount: 500,
  currency_code: "rub",
  status: "pending",
  data: { paymentId: "pay_poll", orderId: ATTEMPT.order_id },
  payment_collection_id: "paycol_poll",
  created_at: new Date("2026-09-10T00:00:00.000Z"),
  updated_at: new Date("2026-09-10T00:00:00.000Z"),
};

const ENABLED_ENV = {
  TBANK_ENABLED: "true",
  TBANK_PAYMENT_PROVIDER_ID: "pp_tbank_tbank",
  TBANK_TERMINAL_KEY: "term_poll",
  TBANK_PASSWORD: "fake-password-never-sent",
  TBANK_RECEIPT_SNAPSHOT_SECRET: Buffer.from("0123456789abcdefghijklmnopqrstuv").toString("base64"),
  TBANK_API_BASE_URL: "https://rest-api-test.tinkoff.ru/v2",
  TBANK_SUCCESS_URL: "https://mariomikke.shop/checkout/success",
  TBANK_FAIL_URL: "https://mariomikke.shop/checkout/fail",
  TBANK_NOTIFICATION_URL: "https://api.mariomikke.shop/hooks/payment/tbank",
} as const;

const BANK_STATE = {
  Success: true,
  ErrorCode: "0",
  TerminalKey: ATTEMPT.terminal_key,
  PaymentId: "pay_poll",
  OrderId: ATTEMPT.order_id,
  Amount: ATTEMPT.expected_amount_kopecks,
  Status: "CONFIRMED",
} as const;

function createHarness(
  attemptOverride: Partial<PaymentAttemptPollRow> = {},
  withWorkflow = true,
  injectTerminal = true,
) {
  let session: PaymentSessionDTO = { ...SESSION };
  let captured = false;
  let linked = false;
  let claimed = false;
  let pollState: "pending" | "leased" | "complete" | "manual_review" = "pending";
  let token = "";
  const orders: string[] = [];
  const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  const notifications = {
    expireStalePaymentAttemptPolls: jest.fn().mockResolvedValue([]),
    claimDuePaymentAttempts: jest.fn().mockImplementation(async ({ leaseToken }: { leaseToken: string }) => {
      if (claimed || pollState !== "pending") return [];
      claimed = true;
      pollState = "leased";
      token = leaseToken;
      return [{ ...ATTEMPT, ...attemptOverride }];
    }),
    renewPaymentAttemptPollLease: jest.fn().mockImplementation(async ({ leaseToken }: { leaseToken: string }) =>
      pollState === "leased" && leaseToken === token ? [{ id: ATTEMPT.id, poll_state: pollState }] : []),
    completePaymentAttemptPoll: jest.fn().mockImplementation(async ({ leaseToken }: { leaseToken: string }) => {
      if (pollState !== "leased" || leaseToken !== token) return [];
      pollState = "complete";
      return [{ id: ATTEMPT.id, poll_state: pollState }];
    }),
    deferPaymentAttemptPoll: jest.fn().mockImplementation(async ({ leaseToken }: { leaseToken: string }) => {
      if (pollState !== "leased" || leaseToken !== token) return [];
      pollState = "pending";
      claimed = false;
      return [{ id: ATTEMPT.id, poll_state: pollState }];
    }),
    failPaymentAttemptPoll: jest.fn().mockImplementation(async ({ leaseToken }: { leaseToken: string }) => {
      if (pollState !== "leased" || leaseToken !== token) return [];
      pollState = "pending";
      return [{ id: ATTEMPT.id, poll_state: pollState }];
    }),
    quarantinePaymentAttemptPoll: jest.fn().mockImplementation(async ({ leaseToken }: { leaseToken: string }) => {
      if (pollState !== "leased" || leaseToken !== token) return [];
      pollState = "manual_review";
      return [{ id: ATTEMPT.id, poll_state: pollState }];
    }),
  };
  const payment = {
    retrievePaymentSession: jest.fn().mockImplementation(async () => session),
    updatePaymentSession: jest.fn().mockImplementation(async (update: Partial<PaymentSessionDTO>) => {
      session = { ...session, ...update };
      return session;
    }),
  };
  const bank = { getState: jest.fn().mockResolvedValue(BANK_STATE) };
  const workflow = jest.fn().mockImplementation(async () => {
    captured = true;
    linked = true;
    session = { ...session, status: "captured" };
    orders.push("order_poll");
    return { errors: [], result: { id: "order_poll" } };
  });
  const durableLinkageChecker = jest.fn().mockImplementation(async () => ({
    paymentCaptured: captured,
    orderLinked: linked,
    ...(linked ? { orderId: "order_poll" } : {}),
  }));
  const locking = { execute: jest.fn().mockImplementation((_key, fn: () => Promise<unknown>) => fn()) };
  const events = { emit: jest.fn().mockResolvedValue(undefined) };
  const reconciler: PaymentReconcilerService = Reflect.construct(PaymentReconcilerService, [{
    logger,
    notifications,
    payment,
    locking,
    tbankClient: bank,
    ...(injectTerminal ? { expectedTerminalKey: ATTEMPT.terminal_key } : {}),
    ...(withWorkflow ? { workflowRunner: workflow } : {}),
    durableLinkageChecker,
    events,
  }]);
  return {
    reconciler, notifications, payment, bank, workflow, events, logger, locking, orders,
    get pollState() { return pollState; },
    setSession(value: PaymentSessionDTO) { session = value; },
    setLinkage(paymentCaptured: boolean, orderLinked: boolean) { captured = paymentCaptured; linked = orderLinked; },
  };
}

const oldEnvironment = Object.fromEntries(
  Object.keys(ENABLED_ENV).map((key) => [key, process.env[key]]),
) as Record<keyof typeof ENABLED_ENV, string | undefined>;

beforeEach(() => {
  Object.assign(process.env, ENABLED_ENV);
});

afterEach(() => {
  for (const [key, value] of Object.entries(oldEnvironment)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("missing T-Bank webhook polling", () => {
  it("projects CONFIRMED exactly once under the payment lock, and verifies durable capture and created order", async () => {
    const h = createHarness();
    const result = await h.reconciler.pollMissingNotifications(3);

    expect(result).toEqual({
      claimed: 1, expired: 0,
      results: [{ status: "processed", id: ATTEMPT.id, action: "captured_projected" }],
    });
    expect(h.locking.execute).toHaveBeenCalledWith("tbank:payment:pay_poll", expect.any(Function), { timeout: 30 });
    expect(h.bank.getState).toHaveBeenCalledWith("pay_poll");
    expect(h.workflow).toHaveBeenCalledWith(
      { action: "captured", data: { session_id: SESSION.id, amount: "500.00" } },
      { transactionId: "tbank_proj_pay_poll", idempotencyKey: "tbank_proj_pay_poll" },
    );
    expect(h.orders).toEqual(["order_poll"]);
    expect(h.notifications.completePaymentAttemptPoll).toHaveBeenCalledTimes(1);
    expect(h.pollState).toBe("complete");
    expect(h.events.emit).toHaveBeenCalledWith({
      name: "tbank.order.paid",
      data: { id: "order_poll" },
    });
    expect((await h.reconciler.pollMissingNotifications()).claimed).toBe(0);
    expect(h.events.emit).toHaveBeenCalledTimes(1);
  });

  it("recovers a paid order when the terminal key comes from the enabled environment", async () => {
    const h = createHarness({}, true, false);
    const result = await h.reconciler.pollMissingNotifications();

    expect(result.results).toEqual([
      { status: "processed", id: ATTEMPT.id, action: "captured_projected" },
    ]);
    expect(h.orders).toEqual(["order_poll"]);
    expect(h.bank.getState).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["provider_id", "pp_other_provider", "provider"],
    ["terminal_key", "other_term", "terminal"],
    ["order_id", "other_order", "OrderId"],
    ["expected_amount_kopecks", 51_000, "amount"],
    ["currency_code", "usd", "currency"],
  ] as const)("quarantines attempt %s mismatch without calling the bank", async (field, value, reason) => {
    const h = createHarness({ ...ATTEMPT, [field]: value });
    const result = await h.reconciler.pollMissingNotifications();
    expect(result.results).toEqual([expect.objectContaining({ status: "manual_review", reason: expect.stringContaining(reason) })]);
    expect(h.pollState).toBe("manual_review");
    expect(h.logger.error).toHaveBeenCalledWith(expect.stringContaining("tbank.manual_review"));
    expect(h.bank.getState).not.toHaveBeenCalled();
    expect(h.workflow).not.toHaveBeenCalled();
  });

  it.each(["TerminalKey", "PaymentId", "OrderId", "Amount"] as const)(
    "quarantines GetState responses missing mandatory %s identity", async (field) => {
      const h = createHarness();
      const response: Record<string, unknown> = { ...BANK_STATE };
      delete response[field];
      h.bank.getState.mockResolvedValueOnce(response);
      const result = await h.reconciler.pollMissingNotifications();
      expect(result.results).toEqual([expect.objectContaining({ status: "manual_review", reason: expect.stringContaining(field) })]);
      expect(h.notifications.quarantinePaymentAttemptPoll).toHaveBeenCalledTimes(1);
      expect(h.workflow).not.toHaveBeenCalled();
    },
  );

  it("retries network failures without changing the session or creating an order", async () => {
    const h = createHarness();
    h.bank.getState.mockRejectedValueOnce(new Error("GetState network timeout"));
    const result = await h.reconciler.pollMissingNotifications();
    expect(result.results).toEqual([{ status: "retry_scheduled", id: ATTEMPT.id, error: "GetState network timeout" }]);
    expect(h.notifications.failPaymentAttemptPoll).toHaveBeenCalledTimes(1);
    expect(h.pollState).toBe("pending");
    expect(h.payment.updatePaymentSession).not.toHaveBeenCalled();
    expect(h.orders).toEqual([]);
  });

  it("alerts manual review once transient GetState errors exhaust the persisted retry budget", async () => {
    const h = createHarness();
    h.bank.getState.mockRejectedValueOnce(new Error("GetState outage"));
    h.notifications.failPaymentAttemptPoll.mockResolvedValueOnce([{ id: ATTEMPT.id, poll_state: "manual_review" }]);
    const result = await h.reconciler.pollMissingNotifications();
    expect(result.results).toEqual([expect.objectContaining({ status: "manual_review", reason: expect.stringContaining("GetState outage") })]);
    expect(h.logger.error).toHaveBeenCalledWith(expect.stringContaining("tbank.manual_review"));
    expect(h.workflow).not.toHaveBeenCalled();
  });

  it.each([
    ["REJECTED", "error"],
    ["DEADLINE_EXPIRED", "error"],
    ["CANCELED", "canceled"],
    ["REVERSED", "canceled"],
  ])("records terminal %s as %s without a projection", async (status, expected) => {
    const h = createHarness();
    h.bank.getState.mockResolvedValueOnce({ ...BANK_STATE, Status: status });
    const result = await h.reconciler.pollMissingNotifications();
    expect(result.results).toEqual([{ status: "processed", id: ATTEMPT.id, action: expected }]);
    expect(h.payment.updatePaymentSession).toHaveBeenCalledWith(expect.objectContaining({
      status: expected,
      data: expect.objectContaining({ status }),
    }));
    expect(h.workflow).not.toHaveBeenCalled();
  });

  it.each(["NEW", "FORM_SHOWED", "AUTHORIZING", "3DS_CHECKING"])(
    "defers intermediate bank status %s without consuming retry budget", async (status) => {
      const h = createHarness();
      h.bank.getState.mockResolvedValueOnce({ ...BANK_STATE, Status: status });
      const result = await h.reconciler.pollMissingNotifications();
      expect(result.results).toEqual([{ status: "deferred", id: ATTEMPT.id, reason: `Bank payment remains ${status}` }]);
      expect(h.notifications.deferPaymentAttemptPoll).toHaveBeenCalledTimes(1);
      expect(h.notifications.failPaymentAttemptPoll).not.toHaveBeenCalled();
      expect(h.payment.updatePaymentSession).not.toHaveBeenCalled();
      expect(h.workflow).not.toHaveBeenCalled();
    },
  );

  it("leaves AUTHORIZED pending, never triggering the order workflow", async () => {
    const h = createHarness();
    h.bank.getState.mockResolvedValueOnce({ ...BANK_STATE, Status: "AUTHORIZED" });
    const result = await h.reconciler.pollMissingNotifications();
    expect(result.results).toEqual([{ status: "deferred", id: ATTEMPT.id, reason: "Bank payment remains AUTHORIZED" }]);
    expect(h.payment.updatePaymentSession).toHaveBeenCalledWith(expect.objectContaining({
      status: "pending", data: expect.objectContaining({ status: "AUTHORIZED" }),
    }));
    expect(h.workflow).not.toHaveBeenCalled();
    expect(h.pollState).toBe("pending");
    expect(h.notifications.completePaymentAttemptPoll).not.toHaveBeenCalled();
  });

  it("keeps polling after AUTHORIZED and creates an order when the bank later confirms", async () => {
    const h = createHarness();
    h.bank.getState.mockResolvedValueOnce({ ...BANK_STATE, Status: "AUTHORIZED" });

    expect((await h.reconciler.pollMissingNotifications()).results[0]?.status).toBe("deferred");
    expect(h.orders).toEqual([]);
    expect((await h.reconciler.pollMissingNotifications()).results[0]).toEqual({
      status: "processed",
      id: ATTEMPT.id,
      action: "captured_projected",
    });
    expect(h.orders).toEqual(["order_poll"]);
    expect(h.events.emit).toHaveBeenCalledTimes(1);
  });

  it("completes a captured and durably linked session without downgrading it after a bank terminal failure", async () => {
    const h = createHarness();
    h.setSession({ ...SESSION, status: "captured" });
    h.setLinkage(true, true);
    h.bank.getState.mockResolvedValueOnce({ ...BANK_STATE, Status: "REJECTED" });
    const result = await h.reconciler.pollMissingNotifications();
    expect(result.results).toEqual([{ status: "processed", id: ATTEMPT.id, action: "already_captured" }]);
    expect(h.bank.getState).not.toHaveBeenCalled();
    expect(h.payment.updatePaymentSession).not.toHaveBeenCalled();
    expect(h.workflow).not.toHaveBeenCalled();
  });

  it("quarantines contradictory bank failure against a captured session without a linked order", async () => {
    const h = createHarness();
    h.setSession({ ...SESSION, status: "captured" });
    h.setLinkage(true, false);
    h.bank.getState.mockResolvedValueOnce({ ...BANK_STATE, Status: "REJECTED" });
    const result = await h.reconciler.pollMissingNotifications();
    expect(result.results).toEqual([expect.objectContaining({ status: "manual_review", reason: expect.stringContaining("contradicts captured") })]);
    expect(h.payment.updatePaymentSession).not.toHaveBeenCalled();
    expect(h.notifications.completePaymentAttemptPoll).not.toHaveBeenCalled();
  });

  it("retries captured session lacking durable created-order linkage instead of repeating projection", async () => {
    const h = createHarness();
    h.setSession({ ...SESSION, status: "captured" });
    h.setLinkage(true, false);
    const result = await h.reconciler.pollMissingNotifications();
    expect(result.results).toEqual([expect.objectContaining({ status: "retry_scheduled" })]);
    expect(h.notifications.completePaymentAttemptPoll).not.toHaveBeenCalled();
    expect(h.workflow).not.toHaveBeenCalled();
  });

  it("retries workflow errors and an incomplete durable projection, never completing poll prematurely", async () => {
    const h = createHarness();
    h.workflow.mockResolvedValueOnce({ errors: [new Error("workflow unavailable")] });
    const result = await h.reconciler.pollMissingNotifications();
    expect(result.results).toEqual([{ status: "retry_scheduled", id: ATTEMPT.id, error: "workflow unavailable" }]);
    expect(h.notifications.completePaymentAttemptPoll).not.toHaveBeenCalled();
  });

  it("does not capture a session without an order-producing workflow", async () => {
    const h = createHarness({}, false);
    const result = await h.reconciler.pollMissingNotifications();
    expect(result.results).toEqual([expect.objectContaining({
      status: "retry_scheduled",
      error: expect.stringContaining("workflow is unavailable"),
    })]);
    expect(h.payment.updatePaymentSession).not.toHaveBeenCalled();
    expect(h.notifications.completePaymentAttemptPoll).not.toHaveBeenCalled();
  });

  it("retries when workflow reports success but does not durably capture and create the order", async () => {
    const h = createHarness();
    h.workflow.mockResolvedValueOnce({ errors: [] });
    const result = await h.reconciler.pollMissingNotifications();
    expect(result.results).toEqual([expect.objectContaining({
      status: "retry_scheduled",
      error: expect.stringContaining("not both durable"),
    })]);
    expect(h.notifications.completePaymentAttemptPoll).not.toHaveBeenCalled();
  });

  it("does not mark polling complete when capture succeeded but order linkage did not", async () => {
    const h = createHarness();
    h.workflow.mockImplementationOnce(async () => {
      h.setLinkage(true, false);
      return { errors: [] };
    });
    const result = await h.reconciler.pollMissingNotifications();
    expect(result.results).toEqual([expect.objectContaining({ status: "retry_scheduled" })]);
    expect(h.notifications.completePaymentAttemptPoll).not.toHaveBeenCalled();
    expect(h.notifications.quarantinePaymentAttemptPoll).not.toHaveBeenCalled();
  });

  it("fences a worker that loses ownership before calling GetState", async () => {
    const h = createHarness();
    h.notifications.renewPaymentAttemptPollLease.mockResolvedValueOnce([]);
    const result = await h.reconciler.pollMissingNotifications();
    expect(result.results).toEqual([{ status: "ignored", id: ATTEMPT.id, reason: "stale_lease_fenced" }]);
    expect(h.bank.getState).not.toHaveBeenCalled();
    expect(h.workflow).not.toHaveBeenCalled();
    expect(h.notifications.failPaymentAttemptPoll).not.toHaveBeenCalled();
  });

  it("fences a worker whose lease is lost after GetState, before projection", async () => {
    const h = createHarness();
    h.notifications.renewPaymentAttemptPollLease
      .mockResolvedValueOnce([{ id: ATTEMPT.id, poll_state: "leased" }])
      .mockResolvedValueOnce([{ id: ATTEMPT.id, poll_state: "leased" }])
      .mockResolvedValueOnce([]);
    const result = await h.reconciler.pollMissingNotifications();
    expect(result.results).toEqual([{ status: "ignored", id: ATTEMPT.id, reason: "stale_lease_fenced" }]);
    expect(h.bank.getState).toHaveBeenCalledTimes(1);
    expect(h.workflow).not.toHaveBeenCalled();
  });

  it("does not re-project a duplicate parallel poll claim for the same payment attempt", async () => {
    const h = createHarness();
    let releaseBank!: () => void;
    let bankEntered!: () => void;
    const bankWaiting = new Promise<void>((resolve) => { releaseBank = resolve; });
    const entered = new Promise<void>((resolve) => { bankEntered = resolve; });
    h.bank.getState.mockImplementationOnce(async () => {
      bankEntered();
      await bankWaiting;
      return BANK_STATE;
    });
    const first = h.reconciler.pollMissingNotifications();
    await entered;
    const second = h.reconciler.pollMissingNotifications();
    releaseBank();
    const [a, b] = await Promise.all([first, second]);
    expect(a.claimed + b.claimed).toBe(1);
    expect(h.orders).toEqual(["order_poll"]);
    expect(h.bank.getState).toHaveBeenCalledTimes(1);
  });

  it("never calls bank for an attempt whose session has no string PaymentId", async () => {
    const h = createHarness();
    h.setSession({ ...SESSION, data: { orderId: ATTEMPT.order_id } });
    const result = await h.reconciler.pollMissingNotifications();
    expect(result.results).toEqual([expect.objectContaining({ status: "deferred" })]);
    expect(h.bank.getState).not.toHaveBeenCalled();
    expect(h.workflow).not.toHaveBeenCalled();
  });

  it("does no bank or database work when T-Bank is disabled", async () => {
    const h = createHarness();
    for (const key of Object.keys(ENABLED_ENV)) delete process.env[key];
    process.env.TBANK_ENABLED = "false";
    expect(await h.reconciler.pollMissingNotifications()).toEqual({
      claimed: 0, expired: 0, results: [], skipped: "tbank_disabled",
    });
    expect(h.notifications.expireStalePaymentAttemptPolls).not.toHaveBeenCalled();
    expect(h.notifications.claimDuePaymentAttempts).not.toHaveBeenCalled();
    expect(h.bank.getState).not.toHaveBeenCalled();
  });

  it("logs only attempts genuinely expired into manual review", async () => {
    const h = createHarness();
    h.notifications.expireStalePaymentAttemptPolls.mockResolvedValueOnce([
      { id: "tbatt_expired", poll_state: "manual_review" },
      { id: "tbatt_paid", poll_state: "complete" },
    ]);
    const result = await h.reconciler.pollMissingNotifications();
    expect(result.expired).toBe(1);
    expect(h.logger.error).toHaveBeenCalledTimes(1);
    expect(h.logger.error).toHaveBeenCalledWith(expect.stringContaining("tbatt_expired"));
  });
});
