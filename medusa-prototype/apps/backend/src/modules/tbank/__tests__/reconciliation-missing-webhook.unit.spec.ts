import type { PaymentSessionDTO } from "@medusajs/types";

import { PaymentReconcilerService } from "../services/payment-reconciler";

const attempt = {
  id: "tbatt_1", payment_session_id: "payses_1", provider_id: "pp_tbank_tbank",
  terminal_key: "term", order_id: "payses_1", expected_amount_kopecks: 10000,
  currency_code: "rub", poll_count: 1,
};
const session: PaymentSessionDTO = {
  id: "payses_1", provider_id: "pp_tbank_tbank", amount: 100,
  currency_code: "rub", status: "pending", payment_collection_id: "pc_1",
  data: { attemptId: "tbatt_1", paymentId: "pay_1", orderId: "payses_1" },
  created_at: new Date(), updated_at: new Date(),
};
const confirmed = {
  Success: true, ErrorCode: "0", TerminalKey: "term", OrderId: "payses_1",
  PaymentId: "pay_1", Amount: 10000, Status: "CONFIRMED",
};

function fixture(initialCaptured = false, linked = initialCaptured) {
  let captured = initialCaptured;
  let claimed = false;
  const store = {
    quarantineExpiredExhausted: jest.fn().mockResolvedValue([]),
    claimNotificationById: jest.fn().mockResolvedValue([]),
    claimInbox: jest.fn().mockResolvedValue([]),
    renewInboxLease: jest.fn().mockResolvedValue([]),
    completeInbox: jest.fn().mockResolvedValue([]),
    failInbox: jest.fn().mockResolvedValue([]),
    quarantineConflict: jest.fn().mockResolvedValue([]),
    retryManualReview: jest.fn().mockResolvedValue([]),
    resolveManualReview: jest.fn().mockResolvedValue([]),
    claimDuePaymentAttempts: jest.fn().mockImplementation(async () => {
      if (claimed) return [];
      claimed = true;
      return [attempt];
    }),
    renewPaymentAttemptPoll: jest.fn().mockResolvedValue([attempt]),
    observePaymentAttemptPoll: jest.fn().mockResolvedValue([attempt]),
    finishPaymentAttemptPoll: jest.fn().mockImplementation(async ({ outcome }) => {
      if (outcome === "retry") claimed = false;
      return [attempt];
    }),
    listTbankNotifications: jest.fn().mockResolvedValue([]),
  };
  const bank = { getState: jest.fn().mockResolvedValue(confirmed) };
  const payment = {
    retrievePaymentSession: jest.fn().mockResolvedValue(session),
    updatePaymentSession: jest.fn(),
  };
  const workflow = jest.fn().mockImplementation(async () => {
    captured = true;
    linked = true;
    return { errors: [] };
  });
  const events = { emit: jest.fn().mockResolvedValue(undefined) };
  const lock = jest.fn().mockImplementation(async (_key, action) => action());
  const reconciler = new PaymentReconcilerService({
    notifications: store, payment, tbankClient: bank,
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as never,
    locking: { execute: lock } as never,
    expectedTerminalKey: "term", workflowRunner: workflow, events,
    durableLinkageChecker: jest.fn().mockImplementation(async () => ({
      paymentCaptured: captured, orderLinked: linked, ...(linked ? { orderId: "order_1" } : {}),
    })),
  });
  return { store, bank, payment, workflow, events, lock, reconciler };
}

describe("missing authenticated webhook: durable bank polling", () => {
  it("projects a verified CONFIRMED exactly once through the webhook's idempotent workflow and durable order check", async () => {
    const { reconciler, bank, store, workflow, events, lock, payment } = fixture();
    expect(await reconciler.processMissingWebhookBatch()).toMatchObject({
      claimed: 1, results: [{ status: "completed" }],
    });
    expect(bank.getState).toHaveBeenCalledWith("pay_1");
    expect(lock).toHaveBeenCalledWith("tbank:payment:pay_1", expect.any(Function), { timeout: 30 });
    expect(store.observePaymentAttemptPoll).toHaveBeenCalledWith(expect.objectContaining({ status: "CONFIRMED" }));
    expect(workflow).toHaveBeenCalledWith(
      { action: "captured", data: { session_id: "payses_1", amount: "100.00" } },
      { transactionId: "tbank_proj_pay_1", idempotencyKey: "tbank_proj_pay_1" },
    );
    expect(events.emit).toHaveBeenCalledWith({ name: "tbank.order.paid", data: { id: "order_1" } });
    expect(payment.updatePaymentSession).not.toHaveBeenCalled();
    expect(await reconciler.processMissingWebhookBatch()).toMatchObject({ claimed: 0 });
    expect(events.emit).toHaveBeenCalledTimes(1);
  });

  it("keeps AUTHORIZED pending with a durable observation and bounded retry, never projecting or notifying", async () => {
    const { reconciler, bank, store, workflow, events, payment } = fixture();
    bank.getState.mockResolvedValue({ ...confirmed, Status: "AUTHORIZED" });
    expect((await reconciler.processMissingWebhookBatch()).results).toEqual([{ id: attempt.id, status: "retry" }]);
    expect(store.observePaymentAttemptPoll).toHaveBeenCalledWith(expect.objectContaining({ status: "AUTHORIZED" }));
    expect(store.finishPaymentAttemptPoll).toHaveBeenCalledWith(expect.objectContaining({ outcome: "retry" }));
    expect(workflow).not.toHaveBeenCalled();
    expect(events.emit).not.toHaveBeenCalled();
    expect(payment.updatePaymentSession).not.toHaveBeenCalled();
  });

  it.each([
    { PaymentId: "other" }, { TerminalKey: "other" }, { OrderId: "other" },
    { Amount: 9999 }, { Status: "UNRECOGNIZED" },
  ])("quarantines mismatched GetState identity or status without capture: %p", async (change) => {
    const { reconciler, bank, store, workflow, events } = fixture();
    bank.getState.mockResolvedValue({ ...confirmed, ...change });
    expect((await reconciler.processMissingWebhookBatch()).results).toEqual([{ id: attempt.id, status: "manual_review" }]);
    expect(store.observePaymentAttemptPoll).not.toHaveBeenCalled();
    expect(workflow).not.toHaveBeenCalled();
    expect(events.emit).not.toHaveBeenCalled();
  });

  it("does not query the bank when the authenticated CONFIRMED inbox already owns processing", async () => {
    const { reconciler, bank, store, workflow } = fixture();
    store.listTbankNotifications.mockResolvedValue([{ id: "tbnotif_signed" }]);
    expect((await reconciler.processMissingWebhookBatch()).results).toEqual([{ id: attempt.id, status: "completed" }]);
    expect(bank.getState).not.toHaveBeenCalled();
    expect(workflow).not.toHaveBeenCalled();
  });

  it("does not use an uncorrelated session to call GetState", async () => {
    const { reconciler, bank, payment, workflow, store } = fixture();
    payment.retrievePaymentSession.mockResolvedValue({ ...session, data: { ...session.data, attemptId: "another" } });
    expect((await reconciler.processMissingWebhookBatch()).results).toEqual([{ id: attempt.id, status: "manual_review" }]);
    expect(bank.getState).not.toHaveBeenCalled();
    expect(workflow).not.toHaveBeenCalled();
    expect(store.finishPaymentAttemptPoll).toHaveBeenCalledWith(expect.objectContaining({ outcome: "manual_review" }));
  });

  it("quarantines a pre-Init attempt without a persisted PaymentId without calling GetState", async () => {
    const { reconciler, bank, payment, workflow, store } = fixture();
    payment.retrievePaymentSession.mockResolvedValue({ ...session, data: { ...session.data, paymentId: undefined } });
    expect((await reconciler.processMissingWebhookBatch()).results).toEqual([{ id: attempt.id, status: "manual_review" }]);
    expect(bank.getState).not.toHaveBeenCalled();
    expect(workflow).not.toHaveBeenCalled();
    expect(store.finishPaymentAttemptPoll).toHaveBeenCalledWith(expect.objectContaining({ outcome: "manual_review" }));
  });

  it("preserves confirmed observation and retries when workflow or durable linkage fails", async () => {
    const { reconciler, store, workflow, events } = fixture();
    workflow.mockResolvedValue({ errors: [new Error("workflow failed")] });
    expect((await reconciler.processMissingWebhookBatch()).results).toEqual([{ id: attempt.id, status: "retry" }]);
    expect(store.observePaymentAttemptPoll).toHaveBeenCalledWith(expect.objectContaining({ status: "CONFIRMED" }));
    expect(store.finishPaymentAttemptPoll).toHaveBeenCalledWith(expect.objectContaining({ outcome: "retry" }));
    expect(events.emit).not.toHaveBeenCalled();
  });

  it("never regresses an already captured payment when the bank now reports failure", async () => {
    const { reconciler, bank, workflow, events, payment, store } = fixture(true);
    bank.getState.mockResolvedValue({ ...confirmed, Status: "REVERSED" });
    expect((await reconciler.processMissingWebhookBatch()).results).toEqual([{ id: attempt.id, status: "manual_review" }]);
    expect(store.observePaymentAttemptPoll).toHaveBeenCalledWith(expect.objectContaining({ status: "REVERSED" }));
    expect(workflow).not.toHaveBeenCalled();
    expect(payment.updatePaymentSession).not.toHaveBeenCalled();
    expect(events.emit).not.toHaveBeenCalled();
  });

  it("retries a transient GetState failure without fabricating a bank status or a capture", async () => {
    const { reconciler, bank, store, workflow, events } = fixture();
    bank.getState.mockRejectedValue(new Error("bank timed out"));
    expect((await reconciler.processMissingWebhookBatch()).results).toEqual([{ id: attempt.id, status: "retry" }]);
    expect(store.observePaymentAttemptPoll).not.toHaveBeenCalled();
    expect(store.finishPaymentAttemptPoll).toHaveBeenCalledWith(expect.objectContaining({ outcome: "retry" }));
    expect(workflow).not.toHaveBeenCalled();
    expect(events.emit).not.toHaveBeenCalled();
  });

  it("requires distributed locking before claiming or querying a bank", async () => {
    const { bank, store, payment, workflow, events } = fixture();
    const reconciler = new PaymentReconcilerService({ notifications: store, payment, tbankClient: bank,
      logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as never,
      expectedTerminalKey: "term", workflowRunner: workflow, events,
      durableLinkageChecker: jest.fn(),
    });
    await expect(reconciler.processMissingWebhookBatch()).rejects.toThrow("distributed payment locking");
    expect(store.claimDuePaymentAttempts).not.toHaveBeenCalled();
    expect(bank.getState).not.toHaveBeenCalled();
  });

  it.each([
    { provider_id: "pp_other_provider" }, { terminal_key: "another" },
    { order_id: "another" }, { expected_amount_kopecks: 9999 }, { currency_code: "usd" },
  ])("quarantines a durable attempt mismatch without bank work: %p", async (change) => {
    const { reconciler, store, bank, workflow } = fixture();
    store.claimDuePaymentAttempts.mockResolvedValue([{ ...attempt, ...change }]);
    expect((await reconciler.processMissingWebhookBatch()).results).toEqual([{ id: attempt.id, status: "manual_review" }]);
    expect(bank.getState).not.toHaveBeenCalled();
    expect(workflow).not.toHaveBeenCalled();
  });

  it.each(["TerminalKey", "PaymentId", "OrderId", "Amount"] as const)(
    "quarantines bank responses missing mandatory %s identity", async (field) => {
      const { reconciler, bank, store, workflow } = fixture();
      const response: Record<string, unknown> = { ...confirmed };
      delete response[field];
      bank.getState.mockResolvedValue(response);
      expect((await reconciler.processMissingWebhookBatch()).results).toEqual([{ id: attempt.id, status: "manual_review" }]);
      expect(store.observePaymentAttemptPoll).not.toHaveBeenCalled();
      expect(workflow).not.toHaveBeenCalled();
    },
  );

  it.each(["NEW", "FORM_SHOWED", "AUTHORIZING", "3DS_CHECKING", "AUTHORIZED"])(
    "keeps %s unprojected and recovers when the bank subsequently confirms", async (status) => {
      const { reconciler, bank, workflow, events } = fixture();
      bank.getState.mockResolvedValueOnce({ ...confirmed, Status: status });
      expect((await reconciler.processMissingWebhookBatch()).results[0]?.status).toBe("retry");
      expect(workflow).not.toHaveBeenCalled();
      expect((await reconciler.processMissingWebhookBatch()).results[0]?.status).toBe("completed");
      expect(workflow).toHaveBeenCalledTimes(1);
      expect(events.emit).toHaveBeenCalledTimes(1);
    },
  );

  it.each(["REJECTED", "DEADLINE_EXPIRED", "CANCELED", "REVERSED"])(
    "finishes a verified unpaid %s without creating an order", async (status) => {
      const { reconciler, bank, payment, workflow } = fixture();
      bank.getState.mockResolvedValue({ ...confirmed, Status: status });
      expect((await reconciler.processMissingWebhookBatch()).results[0]?.status).toBe("completed");
      expect(payment.updatePaymentSession).toHaveBeenCalledWith(expect.objectContaining({
        status: status === "CANCELED" || status === "REVERSED" ? "canceled" : "error",
      }));
      expect(workflow).not.toHaveBeenCalled();
    },
  );

  it("does not release a captured payment on a contradictory terminal bank state", async () => {
    const { reconciler, bank, payment, workflow } = fixture(true, true);
    bank.getState.mockResolvedValue({ ...confirmed, Status: "CANCELED" });
    expect((await reconciler.processMissingWebhookBatch()).results[0]?.status).toBe("manual_review");
    expect(payment.updatePaymentSession).not.toHaveBeenCalled();
    expect(workflow).not.toHaveBeenCalled();
  });

  it("retries captured payment without durable order linkage without repeating capture", async () => {
    const { reconciler, workflow, events } = fixture(true, false);
    expect((await reconciler.processMissingWebhookBatch()).results[0]?.status).toBe("retry");
    expect(workflow).not.toHaveBeenCalled();
    expect(events.emit).not.toHaveBeenCalled();
  });

  it("does not complete a successful workflow without durable capture and order linkage", async () => {
    const { reconciler, workflow, events } = fixture();
    workflow.mockResolvedValue({ errors: [] });
    expect((await reconciler.processMissingWebhookBatch()).results[0]?.status).toBe("retry");
    expect(events.emit).not.toHaveBeenCalled();
  });

  it("fences lease loss before bank work", async () => {
    const { reconciler, store, bank, workflow } = fixture();
    store.renewPaymentAttemptPoll.mockResolvedValueOnce([]);
    expect((await reconciler.processMissingWebhookBatch()).results[0]?.status).toBe("stale");
    expect(bank.getState).not.toHaveBeenCalled();
    expect(workflow).not.toHaveBeenCalled();
    expect(store.finishPaymentAttemptPoll).not.toHaveBeenCalled();
  });

  it("fences lease loss after bank work before projection", async () => {
    const { reconciler, store, bank, workflow } = fixture();
    store.renewPaymentAttemptPoll.mockResolvedValueOnce([attempt]).mockResolvedValueOnce([attempt]).mockResolvedValueOnce([]);
    expect((await reconciler.processMissingWebhookBatch()).results[0]?.status).toBe("stale");
    expect(bank.getState).toHaveBeenCalledTimes(1);
    expect(workflow).not.toHaveBeenCalled();
  });

  it("claims a concurrent payment attempt only once", async () => {
    const { reconciler, bank, workflow, events } = fixture();
    const results = await Promise.all([reconciler.processMissingWebhookBatch(), reconciler.processMissingWebhookBatch()]);
    expect(results.reduce((total, result) => total + result.claimed, 0)).toBe(1);
    expect(bank.getState).toHaveBeenCalledTimes(1);
    expect(workflow).toHaveBeenCalledTimes(1);
    expect(events.emit).toHaveBeenCalledTimes(1);
  });

  it("requires the order-producing workflow before claiming a payment attempt", async () => {
    const { store, payment, bank, events, lock } = fixture();
    const reconciler = new PaymentReconcilerService({
      notifications: store, payment, tbankClient: bank, expectedTerminalKey: "term",
      logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as never,
      locking: { execute: lock } as never, events, durableLinkageChecker: jest.fn(),
    });
    await expect(reconciler.processMissingWebhookBatch()).rejects.toThrow("order/payment workflow");
    expect(store.claimDuePaymentAttempts).not.toHaveBeenCalled();
    expect(bank.getState).not.toHaveBeenCalled();
    expect(payment.updatePaymentSession).not.toHaveBeenCalled();
  });
});
