import { randomUUID } from "crypto";
import type { Logger, MedusaContainer } from "@medusajs/types";
import type {
  ILockingModule,
  IPaymentModuleService,
  PaymentActions,
  PaymentSessionDTO,
} from "@medusajs/types";
import { Modules } from "@medusajs/framework/utils";
import { processPaymentWorkflow } from "@medusajs/core-flows";

import { TBANK_NOTIFICATION_MODULE } from "../../tbank-notifications";
import {
  correlateNotification,
  type AuthenticatedNotification,
} from "../../tbank-notifications/lifecycle";
import { kopecksToRubles } from "../lib/money";
import { parseTbankEnvironment } from "../config";
import { TBankClient, type TBankGetStateResult } from "../lib/client";

export class StaleLeaseError extends Error {
  readonly name = "StaleLeaseError";
  constructor(id: string, leaseToken: string) {
    super(`T-Bank inbox lease lost or expired for notification ${id} (token: ${leaseToken})`);
  }
}

export type ReconcilerWorkflowRunner = (
  input: {
    action: PaymentActions;
    data: { session_id: string; amount?: string | number };
  },
  options?: {
    transactionId?: string;
    idempotencyKey?: string;
  },
) => Promise<{ errors?: unknown[]; result?: unknown }>;

export interface TbankNotificationStore {
  claimNotificationById(input: { id: string; leaseToken: string; now: Date }): Promise<readonly unknown[]>;
  claimInbox(input: { limit: number; leaseToken: string; now: Date }): Promise<readonly unknown[]>;
  renewInboxLease?(input: { id: string; leaseToken: string; now: Date }): Promise<readonly unknown[]>;
  completeInbox(input: { id: string; leaseToken: string; now: Date }): Promise<readonly unknown[]>;
  failInbox(input: { id: string; leaseToken: string; now: Date }): Promise<readonly unknown[]>;
  quarantineManualReview(input: { id: string; leaseToken: string; now: Date }): Promise<readonly unknown[]>;
  retryManualReview(input: { id: string; now: Date; operatorId?: string; reason?: string }): Promise<readonly unknown[]>;
  resolveManualReview(input: { id: string; now: Date; operatorId?: string; reason?: string }): Promise<readonly unknown[]>;
  listTbankNotifications?(filters: Record<string, unknown>): Promise<readonly Record<string, unknown>[]>;
  listTbankPaymentAttempts?(filters: Record<string, unknown>): Promise<readonly Record<string, unknown>[]>;
  listTbankNotificationConflicts?(filters: Record<string, unknown>): Promise<readonly Record<string, unknown>[]>;
  createTbankNotificationConflicts?(input: Record<string, unknown>): Promise<unknown>;
}

export type DurableLinkageChecker = (session: PaymentSessionDTO) => Promise<{
  orderLinked: boolean;
  orderId?: string;
  paymentCaptured: boolean;
}>;

export type EventBusService = {
  emit(event: { name: string; data: unknown }): Promise<void>;
};

export type PaymentReconcilerDependencies = {
  logger?: Logger;
  [TBANK_NOTIFICATION_MODULE]?: TbankNotificationStore;
  notifications?: TbankNotificationStore;
  [Modules.PAYMENT]?: IPaymentModuleService;
  payment?: IPaymentModuleService;
  [Modules.LOCKING]?: ILockingModule;
  locking?: ILockingModule;
  tbankClient?: Pick<TBankClient, "getState">;
  expectedTerminalKey?: string;
  workflowRunner?: ReconcilerWorkflowRunner;
  durableLinkageChecker?: DurableLinkageChecker;
  eventBus?: EventBusService;
  query?: {
    graph: (input: {
      entity: string;
      fields: string[];
      filters?: Record<string, unknown>;
    }) => Promise<{ data: any[] }>;
  };
  container?: MedusaContainer;
};

export type ProcessNotificationResult =
  | { readonly status: "processed"; readonly id: string; readonly action: string }
  | { readonly status: "ignored"; readonly id: string; readonly reason: string }
  | { readonly status: "manual_review"; readonly id: string; readonly reason: string }
  | { readonly status: "retry_scheduled"; readonly id: string; readonly error: string }
  | { readonly status: "not_claimed"; readonly id: string };

export type ProcessBatchResult = {
  readonly claimed: number;
  readonly results: readonly ProcessNotificationResult[];
};

export type ManualReviewDetails = {
  readonly notification: Record<string, unknown>;
  readonly paymentAttempt: Record<string, unknown> | null;
  readonly conflicts: readonly Record<string, unknown>[];
  readonly paymentSession: Record<string, unknown> | null;
};

const IN_MEMORY_MUTEXES = new Map<string, Promise<void>>();

export class PaymentReconcilerService {
  private readonly logger_: Logger;
  private readonly notificationService_: TbankNotificationStore;
  private readonly paymentService_: IPaymentModuleService;
  private readonly lockingService_?: ILockingModule;
  private readonly tbankClient_?: Pick<TBankClient, "getState">;
  private readonly expectedTerminalKey_?: string;
  private readonly workflowRunner_?: ReconcilerWorkflowRunner;
  private readonly durableLinkageChecker_?: DurableLinkageChecker;
  private readonly eventBus_?: EventBusService;
  private readonly query_?: {
    graph: (input: {
      entity: string;
      fields: string[];
      filters?: Record<string, unknown>;
    }) => Promise<{ data: any[] }>;
  };
  private readonly container_?: MedusaContainer;

  constructor(deps: PaymentReconcilerDependencies) {
    this.logger_ = deps.logger ?? (deps.container?.resolve("logger") as Logger) ?? console;
    this.notificationService_ =
      deps[TBANK_NOTIFICATION_MODULE] ??
      deps.notifications ??
      (deps.container?.resolve(TBANK_NOTIFICATION_MODULE) as unknown as TbankNotificationStore);
    this.paymentService_ =
      deps[Modules.PAYMENT] ??
      deps.payment ??
      (deps.container?.resolve(Modules.PAYMENT) as IPaymentModuleService);
    this.lockingService_ =
      deps[Modules.LOCKING] ??
      deps.locking ??
      (deps.container?.resolve(Modules.LOCKING, { allowUnregistered: true }) as ILockingModule | undefined);
    this.eventBus_ =
      deps.eventBus ??
      (deps.container?.resolve("event_bus", { allowUnregistered: true }) as EventBusService | undefined);
    this.query_ =
      deps.query ??
      (deps.container?.resolve("query", { allowUnregistered: true }) as any);
    this.tbankClient_ = deps.tbankClient;
    this.expectedTerminalKey_ = deps.expectedTerminalKey;
    this.workflowRunner_ = deps.workflowRunner;
    this.durableLinkageChecker_ = deps.durableLinkageChecker;
    this.container_ = deps.container;

    // Auto-wire TBankClient & expectedTerminalKey from environment if not provided
    if (!this.tbankClient_ || !this.expectedTerminalKey_) {
      try {
        const config = parseTbankEnvironment(process.env);
        if (config.enabled) {
          if (!this.tbankClient_) {
            this.tbankClient_ = new TBankClient({
              terminalKey: config.options.terminalKey,
              password: config.options.password,
              apiBaseUrl: config.options.apiBaseUrl,
            });
          }
          if (!this.expectedTerminalKey_) {
            this.expectedTerminalKey_ = config.options.terminalKey;
          }
        }
      } catch {
        // Environment not configured or test environment
      }
    }

    if (!this.notificationService_) {
      throw new Error("PaymentReconcilerService requires TbankNotificationModuleService");
    }
    if (!this.paymentService_) {
      throw new Error("PaymentReconcilerService requires PaymentModuleService");
    }
  }

  /**
   * Run an asynchronous job under a per-payment mutex.
   * Lock timeout is set to 30 seconds (not milliseconds, as @medusajs/locking-redis timeout is in seconds).
   */
  private async withPaymentLock<T>(paymentId: string, fn: () => Promise<T>): Promise<T> {
    const lockKey = `tbank:payment:${paymentId}`;
    if (this.lockingService_?.execute) {
      return await this.lockingService_.execute(lockKey, fn, { timeout: 30 });
    }

    // Process-level sequential lock fallback for local environments / tests without Redis locking
    const currentPromise = IN_MEMORY_MUTEXES.get(lockKey) ?? Promise.resolve();
    let releaseLock: () => void = () => {};
    const nextPromise = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    IN_MEMORY_MUTEXES.set(lockKey, currentPromise.then(() => nextPromise));

    await currentPromise;
    try {
      return await fn();
    } finally {
      releaseLock();
      if (IN_MEMORY_MUTEXES.get(lockKey) === nextPromise) {
        IN_MEMORY_MUTEXES.delete(lockKey);
      }
    }
  }

  /**
   * Fenced completion: asserts affected row count > 0; throws StaleLeaseError otherwise.
   */
  private async completeInboxWithFencing_(id: string, leaseToken: string): Promise<void> {
    const updated = await this.notificationService_.completeInbox({ id, leaseToken, now: new Date() });
    if (!updated || updated.length === 0) {
      throw new StaleLeaseError(id, leaseToken);
    }
  }

  /**
   * Fenced failure: asserts affected row count > 0; throws StaleLeaseError otherwise.
   */
  private async failInboxWithFencing_(
    id: string,
    leaseToken: string,
  ): Promise<{ lifecycle_state?: string; attempt_count?: number }> {
    const updated = await this.notificationService_.failInbox({ id, leaseToken, now: new Date() });
    if (!updated || updated.length === 0) {
      throw new StaleLeaseError(id, leaseToken);
    }
    return (updated[0] as { lifecycle_state?: string; attempt_count?: number }) ?? {};
  }

  /**
   * Fenced quarantine: asserts affected row count > 0; throws StaleLeaseError otherwise.
   */
  private async quarantineWithFencing_(id: string, leaseToken: string): Promise<void> {
    const updated = await this.notificationService_.quarantineManualReview({ id, leaseToken, now: new Date() });
    if (!updated || updated.length === 0) {
      throw new StaleLeaseError(id, leaseToken);
    }
  }

  /**
   * Fenced lease renewal: asserts affected row count > 0; throws StaleLeaseError otherwise.
   */
  private async renewLeaseWithFencing_(id: string, leaseToken: string): Promise<void> {
    if (this.notificationService_.renewInboxLease) {
      const updated = await this.notificationService_.renewInboxLease({ id, leaseToken, now: new Date() });
      if (!updated || updated.length === 0) {
        throw new StaleLeaseError(id, leaseToken);
      }
    }
  }

  /**
   * Emit operational alert when a notification enters manual review.
   */
  private async emitManualReviewAlert_(
    row: { id: string; payment_id?: string; order_id?: string },
    reason: string,
  ): Promise<void> {
    try {
      if (this.eventBus_) {
        await this.eventBus_.emit({
          name: "tbank.manual_review.alert",
          data: {
            id: row.id,
            paymentId: row.payment_id,
            orderId: row.order_id,
            reason,
            timestamp: new Date().toISOString(),
          },
        });
      }
    } catch (err) {
      this.logger_.error(`tbank reconciler: failed to emit manual review alert: ${String(err)}`);
    }
  }

  /**
   * Check durable linkage (payment captured, cart completed, order linked).
   */
  private async checkDurableLinkage_(session: PaymentSessionDTO): Promise<{
    orderLinked: boolean;
    orderId?: string;
    paymentCaptured: boolean;
  }> {
    if (this.durableLinkageChecker_) {
      return await this.durableLinkageChecker_(session);
    }

    if (this.query_) {
      try {
        let cartId: string | undefined;
        if (session.payment_collection_id) {
          const { data: cartLinks } = await this.query_.graph({
            entity: "cart_payment_collection",
            fields: ["cart_id"],
            filters: { payment_collection_id: session.payment_collection_id },
          });
          cartId = cartLinks?.[0]?.cart_id;
        }

        let orderId: string | undefined;
        if (cartId) {
          const { data: orderLinks } = await this.query_.graph({
            entity: "order_cart",
            fields: ["order_id"],
            filters: { cart_id: cartId },
          });
          orderId = orderLinks?.[0]?.order_id;
        }

        const { data: payments } = await this.query_.graph({
          entity: "payment",
          fields: ["id", "captured_at"],
          filters: { payment_session_id: session.id },
        });
        const paymentCaptured = (payments?.length ?? 0) > 0 && payments[0].captured_at !== null;

        return {
          orderLinked: Boolean(orderId),
          orderId,
          paymentCaptured,
        };
      } catch (err) {
        this.logger_.warn(`tbank reconciler: query graph linkage check failed: ${String(err)}`);
      }
    }

    // Fallback: check session status
    let isCaptured = session.status === "captured";
    try {
      const retrieved = await this.paymentService_.retrievePaymentSession(session.id);
      if (retrieved.status === "captured") {
        isCaptured = true;
      }
    } catch {
      // Ignored
    }
    return {
      orderLinked: isCaptured,
      paymentCaptured: isCaptured,
    };
  }

  /**
   * Re-correlate notification against session and expected terminal before projection.
   */
  private async verifyCorrelation_(
    row: {
      id: string;
      terminal_key: string;
      payment_id: string;
      status: string;
      order_id: string;
      amount_kopecks: number;
      success: boolean;
      canonical_payload_hash?: string;
    },
    session: PaymentSessionDTO,
    leaseToken: string,
  ): Promise<{ correlated: true } | { correlated: false; reason: string }> {
    const authNotif: AuthenticatedNotification = {
      terminalKey: row.terminal_key,
      orderId: row.order_id,
      paymentId: row.payment_id,
      status: row.status,
      amountKopecks: row.amount_kopecks,
      amountProvided: row.amount_kopecks !== undefined && row.amount_kopecks !== null,
      currencyCode: "rub",
      success: row.success,
    };

    const expectedTerminal = this.expectedTerminalKey_ ?? row.terminal_key;
    const correlation = correlateNotification(authNotif, session, expectedTerminal);

    if (correlation.kind === "mismatch") {
      const reason = `Correlation mismatch: ${correlation.fields.join(", ")}`;
      this.logger_.error(`tbank reconciler: notification ${row.id} failed correlation: ${reason}`);

      if (this.notificationService_.createTbankNotificationConflicts) {
        try {
          await this.notificationService_.createTbankNotificationConflicts({
            canonical_notification_id: row.id,
            terminal_key: row.terminal_key,
            payment_id: row.payment_id,
            status: row.status,
            canonical_payload_hash: row.canonical_payload_hash ?? null,
            conflicting_payload_hash: row.canonical_payload_hash ?? "",
            conflict_kind: "correlation_mismatch",
            correlation_failures: correlation.fields.join(","),
            lifecycle_state: "manual_review",
          });
        } catch (conflictError) {
          this.logger_.error(
            `tbank reconciler: failed to record correlation conflict: ${
              conflictError instanceof Error ? conflictError.message : String(conflictError)
            }`,
          );
        }
      }

      await this.quarantineWithFencing_(row.id, leaseToken);
      await this.emitManualReviewAlert_(row, reason);
      return { correlated: false, reason };
    }

    return { correlated: true };
  }

  /**
   * Strictly validate GetState bank response.
   */
  private validateGetStateResponse_(
    bankState: TBankGetStateResult,
    row: { payment_id: string; amount_kopecks: number; terminal_key: string },
  ): { valid: true } | { valid: false; reason: string } {
    if (bankState.Success !== true) {
      return {
        valid: false,
        reason: `Bank GetState Success is not true (${bankState.ErrorCode ?? "unknown"})`,
      };
    }
    if (String(bankState.PaymentId) !== String(row.payment_id)) {
      return {
        valid: false,
        reason: `Bank GetState PaymentId mismatch (${bankState.PaymentId} != ${row.payment_id})`,
      };
    }
    const expectedTerminal = this.expectedTerminalKey_ ?? row.terminal_key;
    if (bankState["TerminalKey"] && String(bankState["TerminalKey"]) !== expectedTerminal) {
      return {
        valid: false,
        reason: `Bank GetState TerminalKey mismatch (${bankState["TerminalKey"]} != ${expectedTerminal})`,
      };
    }
    if (bankState.Amount !== undefined && Number(bankState.Amount) !== Number(row.amount_kopecks)) {
      return {
        valid: false,
        reason: `Bank GetState Amount mismatch (${bankState.Amount} != ${row.amount_kopecks})`,
      };
    }
    return { valid: true };
  }

  /**
   * Process a single notification by ID (e.g. from event acceleration).
   */
  async processNotification(id: string): Promise<ProcessNotificationResult> {
    const leaseToken = randomUUID();
    const now = new Date();

    let claimedRows;
    try {
      claimedRows = await this.notificationService_.claimNotificationById({
        id,
        leaseToken,
        now,
      });
    } catch (error) {
      this.logger_.error(
        `tbank reconciler: failed to claim notification ${id}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return { status: "retry_scheduled", id, error: String(error) };
    }

    if (!claimedRows || claimedRows.length === 0) {
      return { status: "not_claimed", id };
    }

    const row = claimedRows[0] as unknown as {
      id: string;
      payment_id: string;
      status: string;
      order_id: string;
      amount_kopecks: number;
      terminal_key: string;
      success: boolean;
      lifecycle_state: string;
      attempt_count: number;
      canonical_payload_hash?: string;
    };

    return await this.withPaymentLock(row.payment_id, async () => {
      return await this.processLeasedRow_(row, leaseToken);
    });
  }

  /**
   * Claim and process a batch of pending or expired leased inbox notifications (scheduled recovery).
   */
  async processPendingBatch(limit = 10): Promise<ProcessBatchResult> {
    const leaseToken = randomUUID();
    const now = new Date();

    let claimedRows;
    try {
      claimedRows = await this.notificationService_.claimInbox({ limit, leaseToken, now });
    } catch (error) {
      this.logger_.error(
        `tbank reconciler: batch claim failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return { claimed: 0, results: [] };
    }

    const results: ProcessNotificationResult[] = [];
    for (const rawRow of claimedRows) {
      const row = rawRow as unknown as {
        id: string;
        payment_id: string;
        status: string;
        order_id: string;
        amount_kopecks: number;
        terminal_key: string;
        success: boolean;
        lifecycle_state: string;
        attempt_count: number;
        canonical_payload_hash?: string;
      };

      const result = await this.withPaymentLock(row.payment_id, async () => {
        try {
          await this.renewLeaseWithFencing_(row.id, leaseToken);
        } catch (leaseError) {
          if (leaseError instanceof StaleLeaseError) {
            return {
              status: "ignored",
              id: row.id,
              reason: "stale_lease_fenced",
            } as ProcessNotificationResult;
          }
        }
        return await this.processLeasedRow_(row, leaseToken);
      });
      results.push(result);
    }

    return { claimed: claimedRows.length, results };
  }

  /**
   * Core monotonic reconciliation logic for a claimed/leased notification row.
   */
  private async processLeasedRow_(
    row: {
      id: string;
      payment_id: string;
      status: string;
      order_id: string;
      amount_kopecks: number;
      terminal_key: string;
      success: boolean;
      attempt_count: number;
      canonical_payload_hash?: string;
    },
    leaseToken: string,
  ): Promise<ProcessNotificationResult> {
    try {
      let session: PaymentSessionDTO | undefined;
      try {
        session = await this.paymentService_.retrievePaymentSession(row.order_id);
      } catch (error) {
        this.logger_.warn(
          `tbank reconciler: payment session ${row.order_id} not found for notification ${row.id}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        const failResult = await this.failInboxWithFencing_(row.id, leaseToken);
        if (failResult.lifecycle_state === "manual_review") {
          await this.emitManualReviewAlert_(row, `Payment session ${row.order_id} not found after retries`);
          return { status: "manual_review", id: row.id, reason: `Session ${row.order_id} not found` };
        }
        return {
          status: "retry_scheduled",
          id: row.id,
          error: `Session ${row.order_id} not found`,
        };
      }

      // Re-correlate notification against retrieved session
      const correlationCheck = await this.verifyCorrelation_(row, session, leaseToken);
      if (!correlationCheck.correlated) {
        return { status: "manual_review", id: row.id, reason: correlationCheck.reason };
      }

      const currentSessionStatus = session.status;
      const notifStatus = row.status;

      // 1. CONFIRMED
      if (notifStatus === "CONFIRMED") {
        // Replay barrier: check if order already exists and payment is captured
        const linkageBefore = await this.checkDurableLinkage_(session);
        if (linkageBefore.paymentCaptured && linkageBefore.orderLinked) {
          this.logger_.info(
            `tbank reconciler: replay barrier: order already linked and payment captured for session ${session.id}`,
          );
          await this.completeInboxWithFencing_(row.id, leaseToken);
          return { status: "processed", id: row.id, action: "already_captured" };
        }

        // Renew lease before executing projection
        await this.renewLeaseWithFencing_(row.id, leaseToken);

        const projectionSuccess = await this.projectConfirmedPayment_(row, session);
        if (!projectionSuccess.success) {
          await this.quarantineWithFencing_(row.id, leaseToken);
          const reason = projectionSuccess.error ?? "Projection failed";
          await this.emitManualReviewAlert_(row, reason);
          return { status: "manual_review", id: row.id, reason };
        }

        // Verify durable linkage post-projection
        const linkageAfter = await this.checkDurableLinkage_(session);
        if (!linkageAfter.paymentCaptured) {
          await this.quarantineWithFencing_(row.id, leaseToken);
          const reason = "Payment was not captured after projection";
          await this.emitManualReviewAlert_(row, reason);
          return { status: "manual_review", id: row.id, reason };
        }

        if (!linkageAfter.orderLinked) {
          await this.quarantineWithFencing_(row.id, leaseToken);
          const reason = "Payment captured but order creation failed";
          await this.emitManualReviewAlert_(row, reason);
          return { status: "manual_review", id: row.id, reason };
        }

        // Fully verified: complete inbox
        await this.completeInboxWithFencing_(row.id, leaseToken);
        return { status: "processed", id: row.id, action: "captured_projected" };
      }

      // 2. AUTHORIZED
      if (notifStatus === "AUTHORIZED") {
        if (currentSessionStatus === "captured") {
          await this.completeInboxWithFencing_(row.id, leaseToken);
          return { status: "processed", id: row.id, action: "ignored_captured_precedence" };
        }

        // AUTHORIZED stays pending (never transitions to authorized in 1-stage acquiring)
        await this.paymentService_.updatePaymentSession({
          id: session.id,
          data: { ...(session.data ?? {}), status: "AUTHORIZED" },
          currency_code: session.currency_code,
          amount: session.amount,
          status: "pending",
        });

        await this.completeInboxWithFencing_(row.id, leaseToken);
        return { status: "processed", id: row.id, action: "authorized" };
      }

      // 3. Terminal failure statuses: REJECTED, DEADLINE_EXPIRED, CANCELED, REVERSED
      const isTerminalFailure =
        notifStatus === "REJECTED" ||
        notifStatus === "DEADLINE_EXPIRED" ||
        notifStatus === "CANCELED" ||
        notifStatus === "REVERSED";

      if (isTerminalFailure) {
        if (currentSessionStatus === "captured") {
          this.logger_.warn(
            `tbank reconciler: ignored terminal failure ${notifStatus} for already captured payment ${row.payment_id}`,
          );
          await this.completeInboxWithFencing_(row.id, leaseToken);
          return { status: "processed", id: row.id, action: "ignored_captured_precedence" };
        }

        let resolvedStatus = notifStatus;
        const contradictions = await this.detectContradiction_(row, session);
        if (contradictions && this.tbankClient_) {
          try {
            const bankState = await this.tbankClient_.getState(row.payment_id);
            const validation = this.validateGetStateResponse_(bankState, row);
            if (!validation.valid) {
              await this.quarantineWithFencing_(row.id, leaseToken);
              await this.emitManualReviewAlert_(row, validation.reason);
              return { status: "manual_review", id: row.id, reason: validation.reason };
            }

            if (bankState.Status === "CONFIRMED") {
              await this.renewLeaseWithFencing_(row.id, leaseToken);
              const projectionSuccess = await this.projectConfirmedPayment_(row, session);
              if (projectionSuccess.success) {
                const verified = await this.checkDurableLinkage_(session);
                if (verified.orderLinked && verified.paymentCaptured) {
                  await this.completeInboxWithFencing_(row.id, leaseToken);
                  return { status: "processed", id: row.id, action: "contradiction_resolved_confirmed" };
                }
              }
              await this.quarantineWithFencing_(row.id, leaseToken);
              const reason = projectionSuccess.error ?? "Projection verification failed";
              await this.emitManualReviewAlert_(row, reason);
              return { status: "manual_review", id: row.id, reason };
            }

            if (bankState.Status) {
              resolvedStatus = bankState.Status;
            }
          } catch (stateError) {
            this.logger_.warn(
              `tbank reconciler: GetState failed during contradiction resolution for ${row.payment_id}: ${
                stateError instanceof Error ? stateError.message : String(stateError)
              }`,
            );
            const failResult = await this.failInboxWithFencing_(row.id, leaseToken);
            if (failResult.lifecycle_state === "manual_review") {
              await this.emitManualReviewAlert_(row, "Max retries on contradiction GetState");
              return { status: "manual_review", id: row.id, reason: "Max retries on contradiction GetState" };
            }
            return {
              status: "retry_scheduled",
              id: row.id,
              error: `Contradiction GetState failed: ${String(stateError)}`,
            };
          }
        }

        const targetStatus =
          resolvedStatus === "CANCELED" || resolvedStatus === "REVERSED" ? "canceled" : "error";

        await this.paymentService_.updatePaymentSession({
          id: session.id,
          data: { ...(session.data ?? {}), status: resolvedStatus },
          currency_code: session.currency_code,
          amount: session.amount,
          status: targetStatus,
        });

        await this.completeInboxWithFencing_(row.id, leaseToken);
        return { status: "processed", id: row.id, action: targetStatus };
      }

      // Non-terminal / unrecognized status (e.g. NEW, FORM_SHOWED)
      await this.completeInboxWithFencing_(row.id, leaseToken);
      return { status: "processed", id: row.id, action: "no_op" };
    } catch (processingError) {
      if (processingError instanceof StaleLeaseError) {
        this.logger_.warn(
          `tbank reconciler: fencing violation: lease for notification ${row.id} expired or reclaimed by another worker`,
        );
        return { status: "ignored", id: row.id, reason: "stale_lease_fenced" };
      }

      this.logger_.error(
        `tbank reconciler: unexpected error processing row ${row.id}: ${
          processingError instanceof Error ? processingError.message : String(processingError)
        }`,
      );

      try {
        const failResult = await this.failInboxWithFencing_(row.id, leaseToken);
        if (failResult.lifecycle_state === "manual_review") {
          await this.emitManualReviewAlert_(
            row,
            `Exhausted retries: ${processingError instanceof Error ? processingError.message : String(processingError)}`,
          );
          return {
            status: "manual_review",
            id: row.id,
            reason: `Exhausted retries: ${processingError instanceof Error ? processingError.message : String(processingError)}`,
          };
        }
      } catch (failErr) {
        if (failErr instanceof StaleLeaseError) {
          return { status: "ignored", id: row.id, reason: "stale_lease_fenced" };
        }
      }

      return {
        status: "retry_scheduled",
        id: row.id,
        error: processingError instanceof Error ? processingError.message : String(processingError),
      };
    }
  }

  /**
   * Project a confirmed payment into Medusa (captured payment, completed cart, linked order).
   */
  private async projectConfirmedPayment_(
    row: { payment_id: string; order_id: string; amount_kopecks: number },
    session: PaymentSessionDTO,
  ): Promise<{ success: boolean; error?: string }> {
    const deterministicKey = `tbank_proj_${row.payment_id}`;
    const workflowInput = {
      action: "captured" as PaymentActions,
      data: {
        session_id: row.order_id,
        amount: kopecksToRubles(row.amount_kopecks),
      },
    };

    try {
      if (this.workflowRunner_) {
        const res = await this.workflowRunner_(workflowInput, {
          transactionId: deterministicKey,
          idempotencyKey: deterministicKey,
        });
        if (res.errors && res.errors.length > 0) {
          const firstErr = res.errors[0];
          return {
            success: false,
            error: firstErr instanceof Error ? firstErr.message : JSON.stringify(firstErr),
          };
        }
        return { success: true };
      }

      if (this.container_) {
        const { errors } = await processPaymentWorkflow(this.container_).run({
          input: workflowInput,
          context: {
            transactionId: deterministicKey,
            idempotencyKey: deterministicKey,
          },
          throwOnError: false,
        });

        if (errors && errors.length > 0) {
          const firstErr = errors[0];
          return {
            success: false,
            error: firstErr instanceof Error ? firstErr.message : JSON.stringify(firstErr),
          };
        }
        return { success: true };
      }

      // Standalone/unit execution fallback: update session to captured
      await this.paymentService_.updatePaymentSession({
        id: session.id,
        data: { ...(session.data ?? {}), status: "CONFIRMED" },
        currency_code: session.currency_code,
        amount: session.amount,
        status: "captured",
      });
      return { success: true };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * Detect contradictory notifications or session data for the same payment.
   */
  private async detectContradiction_(
    row: { payment_id: string; id: string; status: string },
    session: PaymentSessionDTO,
  ): Promise<boolean> {
    if (session.status === "authorized" || session.status === "captured") {
      return true;
    }

    try {
      if (this.notificationService_.listTbankNotifications) {
        const related = await this.notificationService_.listTbankNotifications({
          payment_id: row.payment_id,
        });
        return related.some(
          (n: { id: string; status?: string }) =>
            n.id !== row.id && (n.status === "CONFIRMED" || n.status === "AUTHORIZED"),
        );
      }
    } catch {
      // Ignored
    }
    return false;
  }

  /**
   * Operator method: Inspect full state of a manual review row.
   */
  async inspectManualReview(id: string): Promise<ManualReviewDetails> {
    const notifications = await this.notificationService_.listTbankNotifications?.({ id });
    if (!notifications || notifications.length === 0) {
      throw new Error(`Notification ${id} not found`);
    }
    const notif = notifications[0] as unknown as Record<string, unknown>;

    let paymentAttempt: Record<string, unknown> | null = null;
    try {
      if (this.notificationService_.listTbankPaymentAttempts && notif["order_id"]) {
        const attempts = await this.notificationService_.listTbankPaymentAttempts({
          order_id: String(notif["order_id"]),
        });
        paymentAttempt = (attempts[0] as unknown as Record<string, unknown>) ?? null;
      }
    } catch {
      paymentAttempt = null;
    }

    let conflicts: Record<string, unknown>[] = [];
    try {
      if (this.notificationService_.listTbankNotificationConflicts && notif["payment_id"]) {
        const found = await this.notificationService_.listTbankNotificationConflicts({
          payment_id: String(notif["payment_id"]),
        });
        conflicts = (found as unknown as Record<string, unknown>[]) ?? [];
      }
    } catch {
      conflicts = [];
    }

    let paymentSession: Record<string, unknown> | null = null;
    try {
      if (notif["order_id"]) {
        const ses = await this.paymentService_.retrievePaymentSession(String(notif["order_id"]));
        paymentSession = ses as unknown as Record<string, unknown>;
      }
    } catch {
      paymentSession = null;
    }

    return {
      notification: notif,
      paymentAttempt,
      conflicts,
      paymentSession,
    };
  }

  /**
   * Operator method: Reset manual review row to pending for automatic re-execution.
   */
  async retryManualReview(
    id: string,
    options?: { operatorId?: string; reason?: string },
  ): Promise<void> {
    const now = new Date();
    await this.notificationService_.retryManualReview({
      id,
      now,
      operatorId: options?.operatorId,
      reason: options?.reason,
    });
    this.logger_.info(
      `tbank reconciler: operator ${options?.operatorId ?? "unknown"} reset manual review row ${id} to pending: ${
        options?.reason ?? "no reason provided"
      }`,
    );
  }

  /**
   * Operator method: Mark manual review row as resolved with audited reason.
   */
  async resolveManualReview(
    id: string,
    resolution: { reason: string; operatorId?: string },
  ): Promise<void> {
    const now = new Date();
    await this.notificationService_.resolveManualReview({
      id,
      now,
      operatorId: resolution.operatorId,
      reason: resolution.reason,
    });
    this.logger_.info(
      `tbank reconciler: operator ${resolution.operatorId ?? "unknown"} resolved manual review row ${id}: ${resolution.reason}`,
    );
  }
}

export default PaymentReconcilerService;
