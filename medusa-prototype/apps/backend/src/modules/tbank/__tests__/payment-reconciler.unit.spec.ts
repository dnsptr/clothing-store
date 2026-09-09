import { PaymentReconcilerService } from "../services/payment-reconciler";
import type { PaymentSessionDTO } from "@medusajs/types";

describe("PaymentReconcilerService unit tests", () => {
  let mockLogger: { info: jest.Mock; warn: jest.Mock; error: jest.Mock };
  let mockNotificationService: any;
  let mockPaymentService: any;
  let mockLocking: any;
  let mockTbankClient: any;
  let mockWorkflowRunner: jest.Mock;

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
    mockLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };

    mockNotificationService = {
      claimNotificationById: jest.fn().mockResolvedValue([sampleRow]),
      claimInbox: jest.fn().mockResolvedValue([sampleRow]),
      completeInbox: jest.fn().mockResolvedValue([{ ...sampleRow, lifecycle_state: "processed" }]),
      failInbox: jest.fn().mockResolvedValue([{ ...sampleRow, lifecycle_state: "pending" }]),
      quarantineManualReview: jest.fn().mockResolvedValue([{ ...sampleRow, lifecycle_state: "manual_review" }]),
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
      execute: jest.fn().mockImplementation((key, fn) => fn()),
    };

    mockTbankClient = {
      getState: jest.fn(),
    };

    mockWorkflowRunner = jest.fn().mockResolvedValue({ errors: [], result: { id: "order_1" } });
  });

  function createReconciler(overrides = {}) {
    return new PaymentReconcilerService({
      logger: mockLogger as any,
      notifications: mockNotificationService,
      payment: mockPaymentService,
      locking: mockLocking,
      tbankClient: mockTbankClient,
      workflowRunner: mockWorkflowRunner,
      ...overrides,
    });
  }

  describe("Per-payment locking and deterministic idempotency", () => {
    it("acquires lock with key tbank:payment:<paymentId> and timeout 30s", async () => {
      const reconciler = createReconciler();
      const result = await reconciler.processNotification("tbnotif_1");

      expect(result.status).toBe("processed");
      expect(mockLocking.execute).toHaveBeenCalledWith(
        "tbank:payment:pay_100",
        expect.any(Function),
        { timeout: 30000 },
      );
    });

    it("passes deterministic transactionId and idempotencyKey to projection workflow", async () => {
      const reconciler = createReconciler();
      await reconciler.processNotification("tbnotif_1");

      expect(mockWorkflowRunner).toHaveBeenCalledWith(
        {
          action: "captured",
          data: {
            session_id: "payses_100",
            amount: "500.00",
          },
        },
        {
          transactionId: "tbank_proj_pay_100",
          idempotencyKey: "tbank_proj_pay_100",
        },
      );
    });
  });

  describe("Monotonic transitions and conflict reconciliation", () => {
    it("projects CONFIRMED payment and marks inbox completed", async () => {
      const reconciler = createReconciler();
      const result = await reconciler.processNotification("tbnotif_1");

      expect(result.status).toBe("processed");
      expect(result).toHaveProperty("action", "captured_projected");
      expect(mockWorkflowRunner).toHaveBeenCalledTimes(1);
      expect(mockNotificationService.completeInbox).toHaveBeenCalledWith(
        expect.objectContaining({ id: "tbnotif_1" }),
      );
    });

    it("is idempotent: already captured session marks inbox completed without running workflow", async () => {
      mockPaymentService.retrievePaymentSession.mockResolvedValueOnce({
        ...sampleSession,
        status: "captured",
      });

      const reconciler = createReconciler();
      const result = await reconciler.processNotification("tbnotif_1");

      expect(result.status).toBe("processed");
      expect(result).toHaveProperty("action", "already_captured");
      expect(mockWorkflowRunner).not.toHaveBeenCalled();
      expect(mockNotificationService.completeInbox).toHaveBeenCalled();
    });

    it("ensures failure-first cannot suppress a later verified CONFIRMED", async () => {
      mockPaymentService.retrievePaymentSession.mockResolvedValueOnce({
        ...sampleSession,
        status: "error", // previous failure
      });

      const reconciler = createReconciler();
      const result = await reconciler.processNotification("tbnotif_1");

      expect(result.status).toBe("processed");
      expect(result).toHaveProperty("action", "captured_projected");
      // Workflow still runs and completes cart!
      expect(mockWorkflowRunner).toHaveBeenCalledTimes(1);
      expect(mockNotificationService.completeInbox).toHaveBeenCalled();
    });

    it("handles AUTHORIZED: stays pending and does not complete cart or capture", async () => {
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
          status: "authorized",
        }),
      );
      expect(mockNotificationService.completeInbox).toHaveBeenCalled();
    });

    it("ensures AUTHORIZED cannot regress already captured session", async () => {
      mockNotificationService.claimNotificationById.mockResolvedValueOnce([
        { ...sampleRow, status: "AUTHORIZED" },
      ]);
      mockPaymentService.retrievePaymentSession.mockResolvedValueOnce({
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

    it("ensures terminal failure (REJECTED) cannot regress already captured session", async () => {
      mockNotificationService.claimNotificationById.mockResolvedValueOnce([
        { ...sampleRow, status: "REJECTED", success: false },
      ]);
      mockPaymentService.retrievePaymentSession.mockResolvedValueOnce({
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

    it("updates session to error on terminal failure (REJECTED) when pending", async () => {
      mockNotificationService.claimNotificationById.mockResolvedValueOnce([
        { ...sampleRow, status: "REJECTED", success: false },
      ]);
      mockPaymentService.retrievePaymentSession.mockResolvedValueOnce({
        ...sampleSession,
        status: "pending",
      });

      const reconciler = createReconciler();
      const result = await reconciler.processNotification("tbnotif_1");

      expect(result.status).toBe("processed");
      expect(result).toHaveProperty("action", "error");
      expect(mockPaymentService.updatePaymentSession).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "payses_100",
          status: "error",
        }),
      );
      expect(mockNotificationService.completeInbox).toHaveBeenCalled();
    });

    it("updates session to canceled on CANCELED notification", async () => {
      mockNotificationService.claimNotificationById.mockResolvedValueOnce([
        { ...sampleRow, status: "CANCELED", success: false },
      ]);
      mockPaymentService.retrievePaymentSession.mockResolvedValueOnce({
        ...sampleSession,
        status: "pending",
      });

      const reconciler = createReconciler();
      const result = await reconciler.processNotification("tbnotif_1");

      expect(result.status).toBe("processed");
      expect(result).toHaveProperty("action", "canceled");
      expect(mockPaymentService.updatePaymentSession).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "payses_100",
          status: "canceled",
        }),
      );
    });
  });

  describe("Contradictory terminal events call GetState", () => {
    it("calls GetState when contradiction is detected and reconciles to CONFIRMED if bank agrees", async () => {
      mockNotificationService.claimNotificationById.mockResolvedValueOnce([
        { ...sampleRow, status: "REJECTED", success: false },
      ]);
      mockPaymentService.retrievePaymentSession.mockResolvedValueOnce({
        ...sampleSession,
        status: "authorized", // session says authorized, but incoming is REJECTED (contradiction!)
      });

      // Bank ground truth says CONFIRMED!
      mockTbankClient.getState.mockResolvedValueOnce({
        Success: true,
        Status: "CONFIRMED",
        PaymentId: "pay_100",
      });

      const reconciler = createReconciler();
      const result = await reconciler.processNotification("tbnotif_1");

      expect(mockTbankClient.getState).toHaveBeenCalledWith("pay_100");
      expect(result.status).toBe("processed");
      expect(result).toHaveProperty("action", "contradiction_resolved_confirmed");
      expect(mockWorkflowRunner).toHaveBeenCalledTimes(1);
      expect(mockNotificationService.completeInbox).toHaveBeenCalled();
    });

    it("schedules retry if GetState fails during contradiction resolution", async () => {
      mockNotificationService.claimNotificationById.mockResolvedValueOnce([
        { ...sampleRow, status: "REJECTED", success: false },
      ]);
      mockPaymentService.retrievePaymentSession.mockResolvedValueOnce({
        ...sampleSession,
        status: "authorized",
      });

      mockTbankClient.getState.mockRejectedValueOnce(new Error("Bank network timeout"));

      const reconciler = createReconciler();
      const result = await reconciler.processNotification("tbnotif_1");

      expect(result.status).toBe("retry_scheduled");
      expect(mockNotificationService.failInbox).toHaveBeenCalled();
      expect(mockNotificationService.completeInbox).not.toHaveBeenCalled();
    });
  });

  describe("Nonprojectable confirmed payment enters manual_review", () => {
    it("moves row to manual_review and logs operational alert if projection fails permanently", async () => {
      mockWorkflowRunner.mockResolvedValueOnce({
        errors: [new Error("Cart cart_123 has already been completed")],
      });

      const reconciler = createReconciler();
      const result = await reconciler.processNotification("tbnotif_1");

      expect(result.status).toBe("manual_review");
      expect(mockNotificationService.quarantineManualReview).toHaveBeenCalledWith(
        expect.objectContaining({ id: "tbnotif_1" }),
      );
      expect(mockNotificationService.completeInbox).not.toHaveBeenCalled();
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining("cannot project - transitioned to manual_review"),
      );
    });
  });

  describe("Operator manual review operations", () => {
    it("inspectManualReview aggregates notification, attempts, conflicts, and session", async () => {
      mockNotificationService.listTbankNotifications.mockResolvedValueOnce([sampleRow]);
      mockNotificationService.listTbankPaymentAttempts.mockResolvedValueOnce([
        { id: "tbatt_1", payment_session_id: "payses_100" },
      ]);
      mockNotificationService.listTbankNotificationConflicts.mockResolvedValueOnce([
        { id: "tbconf_1", conflict_kind: "canonical_payload_changed" },
      ]);

      const reconciler = createReconciler();
      const details = await reconciler.inspectManualReview("tbnotif_1");

      expect(details.notification).toEqual(sampleRow);
      expect(details.paymentAttempt).toEqual(
        expect.objectContaining({ id: "tbatt_1" }),
      );
      expect(details.conflicts).toHaveLength(1);
      expect(details.paymentSession).toEqual(
        expect.objectContaining({ id: "payses_100" }),
      );
    });

    it("retryManualReview resets row to pending with operator audit", async () => {
      const reconciler = createReconciler();
      await reconciler.retryManualReview("tbnotif_1");

      expect(mockNotificationService.retryManualReview).toHaveBeenCalledWith(
        expect.objectContaining({ id: "tbnotif_1" }),
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining("operator reset manual review row tbnotif_1 to pending"),
      );
    });

    it("resolveManualReview marks row resolved with audited operator id and reason", async () => {
      const reconciler = createReconciler();
      await reconciler.resolveManualReview("tbnotif_1", {
        reason: "Manually verified in bank console",
        operatorId: "op_alice",
      });

      expect(mockNotificationService.resolveManualReview).toHaveBeenCalledWith(
        expect.objectContaining({ id: "tbnotif_1" }),
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining("operator op_alice resolved manual review row tbnotif_1: Manually verified in bank console"),
      );
    });
  });

  describe("Batch recovery (processPendingBatch)", () => {
    it("claims batch from claimInbox and processes each under lock", async () => {
      const row1 = { ...sampleRow, id: "tbnotif_1", payment_id: "pay_1" };
      const row2 = { ...sampleRow, id: "tbnotif_2", payment_id: "pay_2" };
      mockNotificationService.claimInbox.mockResolvedValueOnce([row1, row2]);

      const reconciler = createReconciler();
      const batchResult = await reconciler.processPendingBatch(10);

      expect(batchResult.claimed).toBe(2);
      expect(batchResult.results).toHaveLength(2);
      expect(mockLocking.execute).toHaveBeenCalledWith(
        "tbank:payment:pay_1",
        expect.any(Function),
        expect.any(Object),
      );
      expect(mockLocking.execute).toHaveBeenCalledWith(
        "tbank:payment:pay_2",
        expect.any(Function),
        expect.any(Object),
      );
    });
  });
});
