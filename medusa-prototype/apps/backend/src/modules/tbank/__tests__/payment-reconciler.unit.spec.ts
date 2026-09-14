import {
  PaymentReconcilerService,
  type PaymentReconcilerDependencies,
} from "../services/payment-reconciler";
import type { PaymentSessionDTO } from "@medusajs/types";

describe("PaymentReconcilerService unit tests", () => {
  let mockLogger: { info: jest.Mock; warn: jest.Mock; error: jest.Mock };
  let mockNotificationService: Record<string, jest.Mock>;
  let mockPaymentService: Record<string, jest.Mock>;
  let mockLocking: Record<string, jest.Mock>;
  let mockTbankClient: { getState: jest.Mock };
  let mockWorkflowRunner: jest.Mock;
  let projectionCompleted: boolean;

  const sampleRow = {
    id: "tbnotif_1",
    payment_id: "pay_100",
    status: "CONFIRMED",
    order_id: "payses_100",
    amount_kopecks: 50000,
    terminal_key: "test_term",
    success: true,
    lifecycle_state: "leased",
    attempt_count: 1,
    canonical_payload_hash: "hash_100",
  };

  const sampleSession: PaymentSessionDTO = {
    id: "payses_100",
    amount: 500,
    currency_code: "rub",
    provider_id: "pp_tbank_tbank",
    status: "pending",
    data: { paymentId: "pay_100", orderId: "payses_100" },
    payment_collection_id: "paycol_1",
    created_at: new Date(),
    updated_at: new Date(),
  };

  beforeEach(() => {
    projectionCompleted = false;
    mockLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };

    mockNotificationService = {
      quarantineExpiredExhausted: jest.fn().mockResolvedValue([]),
      claimNotificationById: jest.fn().mockResolvedValue([sampleRow]),
      claimInbox: jest.fn().mockResolvedValue([sampleRow]),
      renewInboxLease: jest.fn().mockResolvedValue([sampleRow]),
      completeInbox: jest.fn().mockResolvedValue([{ ...sampleRow, lifecycle_state: "processed" }]),
      failInbox: jest.fn().mockResolvedValue([{ ...sampleRow, lifecycle_state: "pending" }]),
      quarantineConflict: jest.fn().mockResolvedValue([{ ...sampleRow, lifecycle_state: "manual_review" }]),
      retryManualReview: jest.fn().mockResolvedValue([{ ...sampleRow, lifecycle_state: "pending" }]),
      resolveManualReview: jest.fn().mockResolvedValue([{ ...sampleRow, lifecycle_state: "processed" }]),
      listTbankNotifications: jest.fn().mockResolvedValue([sampleRow]),
      listTbankPaymentAttempts: jest.fn().mockResolvedValue([]),
      listTbankNotificationConflicts: jest.fn().mockResolvedValue([]),
    };

    mockPaymentService = {
      retrievePaymentSession: jest.fn().mockResolvedValue({ ...sampleSession }),
      updatePaymentSession: jest.fn().mockResolvedValue({}),
    };

    mockLocking = {
      execute: jest.fn().mockImplementation((_key, fn) => fn()),
    };

    mockTbankClient = {
      getState: jest.fn(),
    };

    mockWorkflowRunner = jest.fn().mockImplementation(async () => {
      projectionCompleted = true;
      mockPaymentService.retrievePaymentSession.mockResolvedValue({
        ...sampleSession,
        status: "captured",
      });
      return { errors: [], result: { id: "order_1" } };
    });

  });

  function createReconciler(overrides: Partial<PaymentReconcilerDependencies> = {}) {
    const dependencies = {
      logger: mockLogger,
      notifications: mockNotificationService,
      payment: mockPaymentService,
      locking: mockLocking,
      tbankClient: mockTbankClient,
      expectedTerminalKey: "test_term",
      workflowRunner: mockWorkflowRunner,
      durableLinkageChecker: jest.fn().mockImplementation(async () => ({
        orderLinked: projectionCompleted,
        paymentCaptured: projectionCompleted,
      })),
      ...overrides,
    };
    const reconciler: PaymentReconcilerService = Reflect.construct(PaymentReconcilerService, [dependencies]);
    return reconciler;
  }

  describe("Finding 1: Lock timeout unit", () => {
    it("acquires lock with key tbank:payment:<paymentId> and timeout 30 (seconds, not ms)", async () => {
      const reconciler = createReconciler();
      const result = await reconciler.processNotification("tbnotif_1");

      expect(result.status).toBe("processed");
      expect(mockLocking.execute).toHaveBeenCalledWith(
        "tbank:payment:pay_100",
        expect.any(Function),
        { timeout: 30 },
      );
    });
  });

  describe("Finding 2: AUTHORIZED stays pending", () => {
    it("handles AUTHORIZED: updates data but keeps status pending (never transitions to authorized)", async () => {
      mockNotificationService.claimNotificationById.mockResolvedValueOnce([
        { ...sampleRow, status: "AUTHORIZED" },
      ]);

      const reconciler = createReconciler();
      const result = await reconciler.processNotification("tbnotif_1");

      expect(result.status).toBe("processed");
      expect(result).toHaveProperty("action", "authorized");
      expect(mockWorkflowRunner).not.toHaveBeenCalled();
      expect(mockPaymentService.updatePaymentSession).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "payses_100",
          status: "pending",
          data: expect.objectContaining({ status: "AUTHORIZED" }),
        }),
      );
      expect(mockNotificationService.completeInbox).toHaveBeenCalled();
    });

    it("ensures AUTHORIZED cannot regress already captured session", async () => {
      mockNotificationService.claimNotificationById.mockResolvedValueOnce([
        { ...sampleRow, status: "AUTHORIZED" },
      ]);
      mockPaymentService.retrievePaymentSession.mockResolvedValue({
        ...sampleSession,
        status: "captured",
      });

      const reconciler = createReconciler();
      const result = await reconciler.processNotification("tbnotif_1");

      expect(result.status).toBe("processed");
      expect(result).toHaveProperty("action", "ignored_captured_precedence");
      expect(mockPaymentService.updatePaymentSession).not.toHaveBeenCalled();
      expect(mockNotificationService.completeInbox).toHaveBeenCalled();
    });
  });

  describe("Finding 3: Deferred awaiting_correlation re-correlation", () => {
    it("quarantines notification to manual_review when amount does not match session", async () => {
      mockNotificationService.claimNotificationById.mockResolvedValueOnce([
        { ...sampleRow, amount_kopecks: 99999 }, // Mismatch: 999.99 vs 500.00
      ]);

      const reconciler = createReconciler();
      const result = await reconciler.processNotification("tbnotif_1");

      expect(result.status).toBe("manual_review");
      expect(result).toHaveProperty("reason", expect.stringContaining("amount"));
      expect(mockWorkflowRunner).not.toHaveBeenCalled();
      expect(mockNotificationService.quarantineConflict).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "tbnotif_1",
          reason: expect.stringContaining("amount"),
        }),
      );
      expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining("tbank.manual_review"));
    });

    it("quarantines notification when terminal_key does not match expected terminal", async () => {
      mockNotificationService.claimNotificationById.mockResolvedValueOnce([
        { ...sampleRow, terminal_key: "wrong_terminal" },
      ]);

      const reconciler = createReconciler();
      const result = await reconciler.processNotification("tbnotif_1");

      expect(result.status).toBe("manual_review");
      expect(result).toHaveProperty("reason", expect.stringContaining("terminal"));
      expect(mockWorkflowRunner).not.toHaveBeenCalled();
      expect(mockNotificationService.quarantineConflict).toHaveBeenCalled();
    });
  });

  describe("Finding 4: GetState response validation", () => {
    it("calls GetState on contradiction, validates response fields, and projects if CONFIRMED", async () => {
      mockNotificationService.claimNotificationById.mockResolvedValueOnce([
        { ...sampleRow, status: "REJECTED", success: false },
      ]);
      mockPaymentService.retrievePaymentSession.mockResolvedValueOnce({
        ...sampleSession,
        status: "authorized", // session authorized contradicts incoming REJECTED
      });

      mockTbankClient.getState.mockResolvedValueOnce({
        Success: true,
        Status: "CONFIRMED",
        PaymentId: "pay_100",
        TerminalKey: "test_term",
        OrderId: "payses_100",
        Amount: 50000,
      });

      const reconciler = createReconciler();
      const result = await reconciler.processNotification("tbnotif_1");

      expect(mockTbankClient.getState).toHaveBeenCalledWith("pay_100");
      expect(result.status).toBe("processed");
      expect(result).toHaveProperty("action", "contradiction_resolved_confirmed");
      expect(mockWorkflowRunner).toHaveBeenCalledTimes(1);
    });

    it("quarantines to manual_review if GetState response fails validation (amount mismatch)", async () => {
      mockNotificationService.claimNotificationById.mockResolvedValueOnce([
        { ...sampleRow, status: "REJECTED", success: false },
      ]);
      mockPaymentService.retrievePaymentSession.mockResolvedValueOnce({
        ...sampleSession,
        status: "authorized",
      });

      mockTbankClient.getState.mockResolvedValueOnce({
        Success: true,
        Status: "CONFIRMED",
        PaymentId: "pay_100",
        TerminalKey: "test_term",
        OrderId: "payses_100",
        Amount: 12345, // Mismatch with row.amount_kopecks (50000)
      });

      const reconciler = createReconciler();
      const result = await reconciler.processNotification("tbnotif_1");

      expect(result.status).toBe("manual_review");
      expect(result).toHaveProperty("reason", expect.stringContaining("Amount"));
      expect(mockWorkflowRunner).not.toHaveBeenCalled();
      expect(mockNotificationService.quarantineConflict).toHaveBeenCalled();
      expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining("tbank.manual_review"));
    });
  });

  describe("Finding 5: Lease renewal and stale worker fencing", () => {
    it("renews lease before projection workflow", async () => {
      const reconciler = createReconciler();
      await reconciler.processNotification("tbnotif_1");

      expect(mockNotificationService.renewInboxLease).toHaveBeenCalledWith(
        expect.objectContaining({ id: "tbnotif_1" }),
      );
    });

    it("fences stale worker: ignores row when completeInbox affects 0 rows (lease lost)", async () => {
      mockNotificationService.completeInbox.mockResolvedValueOnce([]); // 0 rows updated

      const reconciler = createReconciler();
      const result = await reconciler.processNotification("tbnotif_1");

      expect(result.status).toBe("ignored");
      expect(result).toHaveProperty("reason", "stale_lease_fenced");
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining("stale lease fenced for tbnotif_1"),
      );
    });

    it("fences stale worker: ignores row when renewLease affects 0 rows", async () => {
      mockNotificationService.renewInboxLease.mockResolvedValueOnce([]); // 0 rows updated

      const reconciler = createReconciler();
      const result = await reconciler.processNotification("tbnotif_1");

      expect(result.status).toBe("ignored");
      expect(result).toHaveProperty("reason", "stale_lease_fenced");
      expect(mockWorkflowRunner).not.toHaveBeenCalled();
    });
  });

  describe("Finding 6 & 7: Proven durable linkage and replay barrier", () => {
    it("replay barrier: completes inbox without re-running workflow if order already exists", async () => {
      const durableLinkageChecker = jest.fn().mockResolvedValue({
        orderLinked: true,
        orderId: "order_already_exists",
        paymentCaptured: true,
      });

      const reconciler = createReconciler({ durableLinkageChecker });
      const result = await reconciler.processNotification("tbnotif_1");

      expect(result.status).toBe("processed");
      expect(result).toHaveProperty("action", "already_captured");
      expect(mockWorkflowRunner).not.toHaveBeenCalled();
      expect(mockNotificationService.completeInbox).toHaveBeenCalled();
    });

    it("retries if projection succeeds but order was not linked (silent cart completion failure)", async () => {
      // First check (replay barrier): not yet linked
      // Second check (post-projection): payment captured BUT order not linked!
      const durableLinkageChecker = jest
        .fn()
        .mockResolvedValueOnce({
          orderLinked: false,
          paymentCaptured: false,
        })
        .mockResolvedValueOnce({
          orderLinked: false,
          paymentCaptured: true,
        });

      const reconciler = createReconciler({ durableLinkageChecker });
      const result = await reconciler.processNotification("tbnotif_1");

      expect(result.status).toBe("retry_scheduled");
      expect(result).toHaveProperty("error", expect.stringContaining("order creation"));
      expect(mockNotificationService.failInbox).toHaveBeenCalled();
      expect(mockNotificationService.quarantineConflict).not.toHaveBeenCalled();
      expect(mockNotificationService.completeInbox).not.toHaveBeenCalled();
    });
  });

  describe("Finding 8: Transient error retry vs manual review", () => {
    it("schedules retry for transient error if attempts < 5", async () => {
      mockPaymentService.retrievePaymentSession.mockRejectedValueOnce(new Error("Transient DB lock"));
      mockNotificationService.failInbox.mockResolvedValueOnce([
        { ...sampleRow, lifecycle_state: "pending", attempt_count: 2 },
      ]);

      const reconciler = createReconciler();
      const result = await reconciler.processNotification("tbnotif_1");

      expect(result.status).toBe("retry_scheduled");
      expect(mockNotificationService.failInbox).toHaveBeenCalled();
    });

    it("moves to manual_review and emits alert when transient error exhausts 5 attempts", async () => {
      mockPaymentService.retrievePaymentSession.mockRejectedValueOnce(new Error("Persistent error"));
      mockNotificationService.failInbox.mockResolvedValueOnce([
        { ...sampleRow, lifecycle_state: "manual_review", attempt_count: 5 },
      ]);

      const reconciler = createReconciler();
      const result = await reconciler.processNotification("tbnotif_1");

      expect(result.status).toBe("manual_review");
      expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining("tbank.manual_review"));
    });
  });

  describe("Finding 9: Operator surface operations", () => {
    const manualReviewRow = { ...sampleRow, lifecycle_state: "manual_review" };

    it("inspectManualReview aggregates notification, attempts, conflicts, and session", async () => {
      mockNotificationService.listTbankNotifications.mockResolvedValueOnce([manualReviewRow]);
      mockNotificationService.listTbankPaymentAttempts.mockResolvedValueOnce([
        { id: "tbatt_1", payment_session_id: "payses_100" },
      ]);
      mockNotificationService.listTbankNotificationConflicts.mockResolvedValueOnce([
        { id: "tbconf_1", conflict_kind: "canonical_payload_changed" },
      ]);

      const reconciler = createReconciler();
      const details = await reconciler.inspectManualReview("tbnotif_1");

      expect(details.notification).toEqual(manualReviewRow);
      expect(details.paymentAttempt).toEqual(expect.objectContaining({ id: "tbatt_1" }));
      expect(details.conflicts).toHaveLength(1);
      expect(details.paymentSession).toEqual(expect.objectContaining({ id: "payses_100" }));
      expect(mockNotificationService.listTbankNotifications).toHaveBeenCalledWith(
        { id: "tbnotif_1" },
        { take: 1 },
      );
      expect(mockNotificationService.listTbankPaymentAttempts).toHaveBeenCalledWith(
        { order_id: "payses_100" },
        { take: 1 },
      );
      expect(mockNotificationService.listTbankNotificationConflicts).toHaveBeenCalledWith(
        { payment_id: "pay_100" },
        { take: 100 },
      );
    });

    it("retryManualReview passes operator ID and reason for audit", async () => {
      mockNotificationService.listTbankNotifications.mockResolvedValueOnce([manualReviewRow]);
      const reconciler = createReconciler();
      await reconciler.retryManualReview("tbnotif_1", {
        operatorId: "op_bob",
        reason: "Fixed network routing",
      });

      expect(mockNotificationService.retryManualReview).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "tbnotif_1",
          operatorId: "op_bob",
          reason: "Fixed network routing",
        }),
      );
    });

    it("resolveManualReview passes operator ID and reason for audit", async () => {
      mockNotificationService.listTbankNotifications.mockResolvedValueOnce([manualReviewRow]);
      const reconciler = createReconciler();
      await reconciler.resolveManualReview("tbnotif_1", {
        operatorId: "op_alice",
        reason: "Manually captured in T-Bank console",
      });

      expect(mockNotificationService.resolveManualReview).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "tbnotif_1",
          operatorId: "op_alice",
          reason: "Manually captured in T-Bank console",
        }),
      );
    });
  });
});
