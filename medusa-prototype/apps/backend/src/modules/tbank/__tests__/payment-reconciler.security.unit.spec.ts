import type { PaymentSessionDTO } from "@medusajs/types";

import {
  PaymentReconcilerService,
  type PaymentReconcilerDependencies,
} from "../services/payment-reconciler";

const ROW = {
  id: "tbnotif_security",
  payment_id: "pay_security",
  status: "CONFIRMED",
  order_id: "payses_security",
  amount_kopecks: 50_000,
  terminal_key: "term_security",
  success: true,
  lifecycle_state: "leased",
  attempt_count: 1,
  canonical_payload_hash: "hash_security",
} as const;

const SESSION: PaymentSessionDTO = {
  id: "payses_security",
  amount: 500,
  currency_code: "rub",
  provider_id: "pp_tbank_tbank",
  status: "pending",
  data: { paymentId: "pay_security", orderId: "payses_security" },
  payment_collection_id: "paycol_security",
  created_at: new Date("2026-09-12T00:00:00.000Z"),
  updated_at: new Date("2026-09-12T00:00:00.000Z"),
};

type Harness = {
  readonly reconciler: PaymentReconcilerService;
  readonly notifications: Record<string, jest.Mock>;
  readonly payment: Record<string, jest.Mock>;
  readonly workflow: jest.Mock;
  readonly bank: { readonly getState: jest.Mock };
};

function createHarness(overrides: Partial<PaymentReconcilerDependencies> = {}): Harness {
  const notifications = {
    quarantineExpiredExhausted: jest.fn().mockResolvedValue([]),
    claimNotificationById: jest.fn().mockResolvedValue([ROW]),
    claimInbox: jest.fn().mockResolvedValue([ROW]),
    renewInboxLease: jest.fn().mockResolvedValue([ROW]),
    completeInbox: jest.fn().mockResolvedValue([ROW]),
    failInbox: jest.fn().mockResolvedValue([{ ...ROW, lifecycle_state: "pending", attempt_count: 2 }]),
    quarantineConflict: jest.fn().mockResolvedValue([ROW]),
    retryManualReview: jest.fn().mockResolvedValue([ROW]),
    resolveManualReview: jest.fn().mockResolvedValue([ROW]),
    listTbankNotifications: jest.fn().mockResolvedValue([]),
  };
  const payment = {
    retrievePaymentSession: jest.fn().mockResolvedValue({ ...SESSION }),
    updatePaymentSession: jest.fn().mockResolvedValue({}),
  };
  const workflow = jest.fn().mockResolvedValue({ errors: [] });
  const bank = { getState: jest.fn() };
  const dependencies = {
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
    notifications,
    payment,
    locking: { execute: jest.fn().mockImplementation((_key, callback) => callback()) },
    tbankClient: bank,
    expectedTerminalKey: "term_security",
    workflowRunner: workflow,
    ...overrides,
  };
  const reconciler: PaymentReconcilerService = Reflect.construct(PaymentReconcilerService, [dependencies]);
  return { reconciler, notifications, payment, workflow, bank };
}

describe("Payment reconciliation security regressions", () => {
  it("propagates notification claim storage errors to the subscriber boundary", async () => {
    const harness = createHarness();
    harness.notifications.claimNotificationById.mockRejectedValueOnce(new Error("claim database unavailable"));

    await expect(harness.reconciler.processNotification(ROW.id)).rejects.toThrow("claim database unavailable");
  });

  it("propagates batch claim storage errors to the job boundary", async () => {
    const harness = createHarness();
    harness.notifications.claimInbox.mockRejectedValueOnce(new Error("batch database unavailable"));

    await expect(harness.reconciler.processPendingBatch(1)).rejects.toThrow("batch database unavailable");
  });

  it("stops a batch when durable lease renewal storage fails", async () => {
    const harness = createHarness();
    harness.notifications.renewInboxLease.mockRejectedValueOnce(new Error("database unavailable"));

    const result = await harness.reconciler.processPendingBatch(1);

    expect(result.results).toEqual([
      expect.objectContaining({ status: "retry_scheduled", id: ROW.id }),
    ]);
    expect(harness.workflow).not.toHaveBeenCalled();
  });

  it.each(["TerminalKey", "PaymentId", "OrderId", "Amount"])(
    "rejects contradictory GetState without mandatory %s identity",
    async (missingField) => {
      const harness = createHarness();
      harness.notifications.claimNotificationById.mockResolvedValueOnce([
        { ...ROW, status: "REJECTED", success: false },
      ]);
      harness.payment.retrievePaymentSession.mockResolvedValueOnce({ ...SESSION, status: "authorized" });
      const bankState: Record<string, unknown> = {
        Success: true,
        ErrorCode: "0",
        Status: "CONFIRMED",
        PaymentId: ROW.payment_id,
        TerminalKey: ROW.terminal_key,
        OrderId: ROW.order_id,
        Amount: ROW.amount_kopecks,
      };
      delete bankState[missingField];
      harness.bank.getState.mockResolvedValueOnce(bankState);

      const result = await harness.reconciler.processNotification(ROW.id);

      expect(result.status).toBe("manual_review");
      expect(harness.workflow).not.toHaveBeenCalled();
    },
  );

  it("rejects contradictory GetState with non-terminal status semantics", async () => {
    const harness = createHarness();
    harness.notifications.claimNotificationById.mockResolvedValueOnce([
      { ...ROW, status: "REJECTED", success: false },
    ]);
    harness.payment.retrievePaymentSession.mockResolvedValueOnce({ ...SESSION, status: "authorized" });
    harness.bank.getState.mockResolvedValueOnce({
      Success: true,
      ErrorCode: "0",
      Status: "NEW",
      PaymentId: ROW.payment_id,
      TerminalKey: ROW.terminal_key,
      OrderId: ROW.order_id,
      Amount: ROW.amount_kopecks,
    });

    const result = await harness.reconciler.processNotification(ROW.id);

    expect(result.status).toBe("manual_review");
    expect(harness.payment.updatePaymentSession).not.toHaveBeenCalled();
  });

  it("keeps a GetState-authorized contradiction pending and never projects paid", async () => {
    const harness = createHarness();
    harness.notifications.claimNotificationById.mockResolvedValueOnce([
      { ...ROW, status: "REJECTED", success: false },
    ]);
    harness.payment.retrievePaymentSession.mockResolvedValueOnce({ ...SESSION, status: "authorized" });
    harness.bank.getState.mockResolvedValueOnce({
      Success: true,
      ErrorCode: "0",
      Status: "AUTHORIZED",
      PaymentId: ROW.payment_id,
      TerminalKey: ROW.terminal_key,
      OrderId: ROW.order_id,
      Amount: ROW.amount_kopecks,
    });

    const result = await harness.reconciler.processNotification(ROW.id);

    expect(result).toEqual(expect.objectContaining({ status: "processed", action: "authorized" }));
    expect(harness.payment.updatePaymentSession).toHaveBeenCalledWith(
      expect.objectContaining({ status: "pending" }),
    );
    expect(harness.workflow).not.toHaveBeenCalled();
  });

  it("uses GetState before handling a captured-session failure notification", async () => {
    const harness = createHarness();
    harness.notifications.claimNotificationById.mockResolvedValueOnce([
      { ...ROW, status: "REJECTED", success: false },
    ]);
    harness.payment.retrievePaymentSession.mockResolvedValue({ ...SESSION, status: "captured" });
    harness.bank.getState.mockResolvedValueOnce({
      Success: true,
      ErrorCode: "0",
      Status: "CONFIRMED",
      PaymentId: ROW.payment_id,
      TerminalKey: ROW.terminal_key,
      OrderId: ROW.order_id,
      Amount: ROW.amount_kopecks,
    });

    await harness.reconciler.processNotification(ROW.id);

    expect(harness.bank.getState).toHaveBeenCalledWith(ROW.payment_id);
  });

  it("does not downgrade a captured session when GetState reports AUTHORIZED", async () => {
    const harness = createHarness();
    harness.notifications.claimNotificationById.mockResolvedValueOnce([
      { ...ROW, status: "REJECTED", success: false },
    ]);
    harness.payment.retrievePaymentSession.mockResolvedValue({ ...SESSION, status: "captured" });
    harness.bank.getState.mockResolvedValueOnce({
      Success: true,
      ErrorCode: "0",
      Status: "AUTHORIZED",
      PaymentId: ROW.payment_id,
      TerminalKey: ROW.terminal_key,
      OrderId: ROW.order_id,
      Amount: ROW.amount_kopecks,
    });

    const result = await harness.reconciler.processNotification(ROW.id);

    expect(result).toEqual(expect.objectContaining({
      status: "processed",
      action: "ignored_captured_precedence",
    }));
    expect(harness.payment.updatePaymentSession).not.toHaveBeenCalled();
  });

  it("does not treat a captured payment session as durable order linkage", async () => {
    const harness = createHarness();
    harness.payment.retrievePaymentSession.mockResolvedValue({ ...SESSION, status: "captured" });

    const result = await harness.reconciler.processNotification(ROW.id);

    expect(result.status).toBe("retry_scheduled");
    expect(harness.notifications.completeInbox).not.toHaveBeenCalled();
    expect(harness.workflow).not.toHaveBeenCalled();
  });

  it("consumes retry budget instead of quarantining a transient workflow failure", async () => {
    const durableLinkageChecker = jest.fn().mockResolvedValue({
      orderLinked: false,
      paymentCaptured: false,
    });
    const harness = createHarness({ durableLinkageChecker });
    harness.workflow.mockResolvedValueOnce({ errors: [new Error("workflow storage timeout")] });

    const result = await harness.reconciler.processNotification(ROW.id);

    expect(result.status).toBe("retry_scheduled");
    expect(harness.notifications.failInbox).toHaveBeenCalled();
    expect(harness.notifications.quarantineConflict).not.toHaveBeenCalled();
  });

  it("renews ownership around AUTHORIZED session mutation", async () => {
    const harness = createHarness();
    harness.notifications.claimNotificationById.mockResolvedValueOnce([
      { ...ROW, status: "AUTHORIZED" },
    ]);

    await harness.reconciler.processNotification(ROW.id);

    expect(harness.notifications.renewInboxLease).toHaveBeenCalledTimes(2);
    expect(harness.payment.updatePaymentSession).toHaveBeenCalledTimes(1);
  });

  it("replays only when captured payment and created-order linkage are both durable", async () => {
    const durableLinkageChecker = jest.fn().mockResolvedValue({
      orderLinked: true,
      orderId: "order_security",
      paymentCaptured: true,
    });
    const harness = createHarness({ durableLinkageChecker });

    const first = await harness.reconciler.processNotification(ROW.id);
    const second = await harness.reconciler.processNotification(ROW.id);

    expect(first).toEqual(expect.objectContaining({ status: "processed", action: "already_captured" }));
    expect(second).toEqual(expect.objectContaining({ status: "processed", action: "already_captured" }));
    expect(harness.workflow).not.toHaveBeenCalled();
  });
});
