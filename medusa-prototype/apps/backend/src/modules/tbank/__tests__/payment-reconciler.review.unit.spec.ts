import type { PaymentSessionDTO } from "@medusajs/types";

import {
  PaymentReconcilerService,
  type PaymentReconcilerDependencies,
} from "../services/payment-reconciler";
import {
  ManualReviewNotFoundError,
  ManualReviewStateError,
} from "../services/manual-review-operations";
import { StaleLeaseError } from "../services/reconciliation-lease";

const ROW = {
  id: "tbnotif_review",
  payment_id: "pay_review",
  status: "CONFIRMED",
  order_id: "payses_review",
  amount_kopecks: 50_000,
  terminal_key: "term_review",
  success: true,
  lifecycle_state: "leased",
  attempt_count: 1,
} as const;

const SESSION: PaymentSessionDTO = {
  id: "payses_review",
  amount: 500,
  currency_code: "rub",
  provider_id: "pp_tbank_tbank",
  status: "pending",
  data: { paymentId: "pay_review", orderId: "payses_review" },
  payment_collection_id: "paycol_review",
  created_at: new Date("2026-09-12T00:00:00.000Z"),
  updated_at: new Date("2026-09-12T00:00:00.000Z"),
};

type ReviewHarness = {
  readonly reconciler: PaymentReconcilerService;
  readonly notifications: Record<string, jest.Mock>;
  readonly payment: Record<string, jest.Mock>;
  readonly bank: { readonly getState: jest.Mock };
  readonly logger: { readonly info: jest.Mock; readonly warn: jest.Mock; readonly error: jest.Mock };
};

function createHarness(overrides: Partial<PaymentReconcilerDependencies> = {}): ReviewHarness {
  const notifications = {
    quarantineExpiredExhausted: jest.fn().mockResolvedValue([]),
    claimNotificationById: jest.fn().mockResolvedValue([ROW]),
    claimInbox: jest.fn().mockResolvedValue([ROW]),
    renewInboxLease: jest.fn().mockResolvedValue([ROW]),
    completeInbox: jest.fn().mockResolvedValue([ROW]),
    failInbox: jest.fn().mockResolvedValue([{ ...ROW, lifecycle_state: "pending", attempt_count: 2 }]),
    quarantineManualReview: jest.fn().mockResolvedValue([ROW]),
    retryManualReview: jest.fn().mockResolvedValue([ROW]),
    resolveManualReview: jest.fn().mockResolvedValue([ROW]),
    listTbankNotifications: jest.fn().mockResolvedValue([]),
    createTbankNotificationConflicts: jest.fn().mockResolvedValue({}),
  };
  const payment = {
    retrievePaymentSession: jest.fn().mockResolvedValue({ ...SESSION }),
    updatePaymentSession: jest.fn().mockResolvedValue({}),
  };
  const bank = { getState: jest.fn() };
  const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  const dependencies = {
    logger,
    notifications,
    payment,
    locking: { execute: jest.fn().mockImplementation((_key, operation) => operation()) },
    tbankClient: bank,
    expectedTerminalKey: ROW.terminal_key,
    durableLinkageChecker: jest.fn().mockResolvedValue({ orderLinked: true, paymentCaptured: true }),
    ...overrides,
  };
  const reconciler: PaymentReconcilerService = Reflect.construct(PaymentReconcilerService, [dependencies]);
  return { reconciler, notifications, payment, bank, logger };
}

function bankState(status: "REJECTED" | "CANCELED") {
  return {
    Success: true,
    ErrorCode: "0",
    Status: status,
    PaymentId: ROW.payment_id,
    TerminalKey: ROW.terminal_key,
    OrderId: ROW.order_id,
    Amount: ROW.amount_kopecks,
  };
}

describe("Payment reconciler consolidated review regressions", () => {
  it.each(["REJECTED", "CANCELED"] as const)(
    "quarantines captured state when GetState reports %s without downgrading it",
    async (status) => {
      const harness = createHarness();
      harness.notifications.claimNotificationById.mockResolvedValueOnce([
        { ...ROW, status: "REJECTED", success: false },
      ]);
      harness.payment.retrievePaymentSession.mockResolvedValueOnce({ ...SESSION, status: "captured" });
      harness.bank.getState.mockResolvedValueOnce(bankState(status));

      const result = await harness.reconciler.processNotification(ROW.id);

      expect(result).toEqual(expect.objectContaining({ status: "manual_review" }));
      expect(harness.payment.updatePaymentSession).not.toHaveBeenCalled();
      expect(harness.notifications.completeInbox).not.toHaveBeenCalled();
      expect(harness.notifications.quarantineManualReview).toHaveBeenCalledTimes(1);
    },
  );

  it("re-reads AUTHORIZED state and never overwrites a concurrently captured session", async () => {
    const harness = createHarness();
    harness.notifications.claimNotificationById.mockResolvedValueOnce([{ ...ROW, status: "AUTHORIZED" }]);
    harness.payment.retrievePaymentSession
      .mockResolvedValueOnce({ ...SESSION, status: "authorized" })
      .mockResolvedValueOnce({ ...SESSION, status: "captured" });

    const result = await harness.reconciler.processNotification(ROW.id);

    expect(result).toEqual(expect.objectContaining({ action: "ignored_captured_precedence" }));
    expect(harness.payment.retrievePaymentSession).toHaveBeenCalledTimes(2);
    expect(harness.payment.updatePaymentSession).not.toHaveBeenCalled();
  });

  it("signals when lease-renewal failure consumes the final retry", async () => {
    const harness = createHarness();
    harness.notifications.renewInboxLease.mockRejectedValueOnce(new Error("renewal storage failed"));
    harness.notifications.failInbox.mockResolvedValueOnce([
      { ...ROW, lifecycle_state: "manual_review", attempt_count: 5 },
    ]);

    const result = await harness.reconciler.processPendingBatch(1);

    expect(result.results).toEqual([expect.objectContaining({ status: "manual_review" })]);
    expect(harness.logger.error).toHaveBeenCalledWith(expect.stringContaining("tbank.manual_review"));
  });

  it("signals every expired exhausted row transitioned before claiming work", async () => {
    const harness = createHarness();
    harness.notifications.quarantineExpiredExhausted.mockResolvedValueOnce([
      { ...ROW, id: "tbnotif_expired_1", lifecycle_state: "manual_review" },
      { ...ROW, id: "tbnotif_expired_2", lifecycle_state: "manual_review" },
    ]);
    harness.notifications.claimInbox.mockResolvedValueOnce([]);

    await harness.reconciler.processPendingBatch(10);

    expect(harness.logger.error).toHaveBeenCalledTimes(2);
    expect(harness.logger.error).toHaveBeenNthCalledWith(1, expect.stringContaining("tbnotif_expired_1"));
    expect(harness.logger.error).toHaveBeenNthCalledWith(2, expect.stringContaining("tbnotif_expired_2"));
  });

  it("serializes fallback work and removes the stored queue after completion", async () => {
    let active = 0;
    let maximumActive = 0;
    let releaseFirst: () => void = () => undefined;
    let notifyFirstStarted: () => void = () => undefined;
    const firstStarted = new Promise<void>((resolve) => { notifyFirstStarted = resolve; });
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const harness = createHarness({ locking: undefined });
    harness.payment.retrievePaymentSession.mockImplementation(async () => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      if (harness.payment.retrievePaymentSession.mock.calls.length === 1) {
        notifyFirstStarted();
        await firstGate;
      }
      active -= 1;
      return { ...SESSION };
    });
    const deleteSpy = jest.spyOn(Map.prototype, "delete");

    const first = harness.reconciler.processNotification(ROW.id);
    await firstStarted;
    const second = harness.reconciler.processNotification(ROW.id);
    await Promise.resolve();
    releaseFirst();
    await Promise.all([first, second]);

    expect(maximumActive).toBe(1);
    expect(deleteSpy).toHaveBeenCalledWith(`tbank:payment:${ROW.payment_id}`);
    deleteSpy.mockRestore();
  });

  it("inspects manual review gracefully when payment session is absent (not found)", async () => {
    const harness = createHarness();
    harness.notifications.listTbankNotifications.mockResolvedValueOnce([
      { ...ROW, lifecycle_state: "manual_review" },
    ]);
    harness.payment.retrievePaymentSession.mockRejectedValueOnce({
      type: "not_found",
      message: "Payment session payses_review was not found",
    });

    const result = await harness.reconciler.inspectManualReview(ROW.id);

    expect(result.notification.id).toBe(ROW.id);
    expect(result.paymentSession).toBeNull();
  });

  it("propagates genuine storage errors during manual review inspection", async () => {
    const harness = createHarness();
    harness.notifications.listTbankNotifications.mockResolvedValueOnce([
      { ...ROW, lifecycle_state: "manual_review" },
    ]);
    harness.payment.retrievePaymentSession.mockRejectedValueOnce(
      new Error("Postgres connection timeout"),
    );

    await expect(harness.reconciler.inspectManualReview(ROW.id)).rejects.toThrow(
      "Postgres connection timeout",
    );
  });

  it("preflights retry and resolve to distinguish missing vs state error", async () => {
    const harness = createHarness();
    harness.notifications.listTbankNotifications
      .mockResolvedValueOnce([]) // missing for retry
      .mockResolvedValueOnce([{ ...ROW, lifecycle_state: "pending" }]) // wrong state for retry
      .mockResolvedValueOnce([]) // missing for resolve
      .mockResolvedValueOnce([{ ...ROW, lifecycle_state: "pending" }]); // wrong state for resolve

    await expect(harness.reconciler.retryManualReview("missing", { operatorId: "op", reason: "r" }))
      .rejects.toThrow(ManualReviewNotFoundError);
    await expect(harness.reconciler.retryManualReview(ROW.id, { operatorId: "op", reason: "r" }))
      .rejects.toThrow(ManualReviewStateError);

    await expect(harness.reconciler.resolveManualReview("missing", { operatorId: "op", reason: "r" }))
      .rejects.toThrow(ManualReviewNotFoundError);
    await expect(harness.reconciler.resolveManualReview(ROW.id, { operatorId: "op", reason: "r" }))
      .rejects.toThrow(ManualReviewStateError);
  });

  it("fences quarantineConflict with lease renewal, aborting stale workers before conflict writes", async () => {
    const harness = createHarness();
    harness.notifications.claimNotificationById.mockResolvedValueOnce([
      { ...ROW, terminal_key: "mismatched_terminal" }, // triggers correlation mismatch
    ]);
    // Stale worker: lease renewal returns empty (lost lease)
    harness.notifications.renewInboxLease.mockResolvedValueOnce([]);

    const result = await harness.reconciler.processNotification(ROW.id);
    expect(result).toEqual(expect.objectContaining({ status: "ignored", reason: "stale_lease_fenced" }));
    expect(harness.notifications.createTbankNotificationConflicts).not.toHaveBeenCalled();
  });
});
