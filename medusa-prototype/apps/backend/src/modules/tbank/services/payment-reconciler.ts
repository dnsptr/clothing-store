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
import type TbankNotificationModuleService from "../../tbank-notifications/service";
import { kopecksToRubles } from "../lib/money";
import type { TBankClient } from "../lib/client";

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
  completeInbox(input: { id: string; leaseToken: string; now: Date }): Promise<readonly unknown[]>;
  failInbox(input: { id: string; leaseToken: string; now: Date }): Promise<readonly unknown[]>;
  quarantineManualReview(input: { id: string; leaseToken: string; now: Date }): Promise<readonly unknown[]>;
  retryManualReview(input: { id: string; now: Date }): Promise<readonly unknown[]>;
  resolveManualReview(input: { id: string; now: Date }): Promise<readonly unknown[]>;
  listTbankNotifications?(filters: Record<string, unknown>): Promise<readonly Record<string, unknown>[]>;
  listTbankPaymentAttempts?(filters: Record<string, unknown>): Promise<readonly Record<string, unknown>[]>;
  listTbankNotificationConflicts?(filters: Record<string, unknown>): Promise<readonly Record<string, unknown>[]>;
}

export type PaymentReconcilerDependencies = {
  logger?: Logger;
  [TBANK_NOTIFICATION_MODULE]?: TbankNotificationStore;
  notifications?: TbankNotificationStore;
  [Modules.PAYMENT]?: IPaymentModuleService;
  payment?: IPaymentModuleService;
  [Modules.LOCKING]?: ILockingModule;
  locking?: ILockingModule;
  tbankClient?: Pick<TBankClient, "getState">;
  workflowRunner?: ReconcilerWorkflowRunner;
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
  private readonly workflowRunner_?: ReconcilerWorkflowRunner;
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
    this.tbankClient_ = deps.tbankClient;
    this.workflowRunner_ = deps.workflowRunner;
    this.container_ = deps.container;

    if (!this.notificationService_) {
      throw new Error("PaymentReconcilerService requires TbankNotificationModuleService");
    }
    if (!this.paymentService_) {
      throw new Error("PaymentReconcilerService requires PaymentModuleService");
    }
  }

  /**
   * Run an asynchronous job under a per-payment mutex.
   */
  private async withPaymentLock<T>(paymentId: string, fn: () => Promise<T>): Promise<T> {
    const lockKey = `tbank:payment:${paymentId}`;
    if (this.lockingService_?.execute) {
      return await this.lockingService_.execute(lockKey, fn, { timeout: 30_000 });
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
      };

      const result = await this.withPaymentLock(row.payment_id, async () => {
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
    },
    leaseToken: string,
  ): Promise<ProcessNotificationResult> {
    const now = new Date();

    let session: PaymentSessionDTO | undefined;
    try {
      session = await this.paymentService_.retrievePaymentSession(row.order_id);
    } catch (error) {
      this.logger_.warn(
        `tbank reconciler: payment session ${row.order_id} not found for notification ${row.id}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      await this.notificationService_.failInbox({ id: row.id, leaseToken, now });
      return {
        status: "retry_scheduled",
        id: row.id,
        error: `Session ${row.order_id} not found`,
      };
    }

    const currentSessionStatus = session.status;
    const notifStatus = row.status;

    try {
      // 1. CONFIRMED
      if (notifStatus === "CONFIRMED") {
        if (currentSessionStatus === "captured") {
          // Idempotent: already captured, mark inbox processed
          await this.notificationService_.completeInbox({ id: row.id, leaseToken, now: new Date() });
          return { status: "processed", id: row.id, action: "already_captured" };
        }

        // Failure-first cannot suppress a later verified CONFIRMED:
        // Even if currentSessionStatus is 'error' or 'canceled', we project CONFIRMED.
        const projectionSuccess = await this.projectConfirmedPayment_(row, session);
        if (projectionSuccess.success) {
          // Durable linkage achieved: complete inbox
          await this.notificationService_.completeInbox({ id: row.id, leaseToken, now: new Date() });
          return { status: "processed", id: row.id, action: "captured_projected" };
        }

        // Projection failed permanently for a valid confirmed payment -> move to manual_review
        await this.notificationService_.quarantineManualReview({
          id: row.id,
          leaseToken,
          now: new Date(),
        });
        this.logger_.error(
          `tbank reconciler: valid confirmed payment ${row.payment_id} (session ${row.order_id}) cannot project - transitioned to manual_review: ${projectionSuccess.error}`,
        );
        return {
          status: "manual_review",
          id: row.id,
          reason: projectionSuccess.error ?? "Projection failed",
        };
      }

      // 2. AUTHORIZED
      if (notifStatus === "AUTHORIZED") {
        // AUTHORIZED stays pending; cannot regress CONFIRMED/captured
        if (currentSessionStatus === "captured") {
          await this.notificationService_.completeInbox({ id: row.id, leaseToken, now: new Date() });
          return { status: "processed", id: row.id, action: "ignored_captured_precedence" };
        }

        await this.paymentService_.updatePaymentSession({
          id: session.id,
          data: { ...(session.data ?? {}), status: "AUTHORIZED" },
          currency_code: session.currency_code,
          amount: session.amount,
          status: "authorized",
        });

        await this.notificationService_.completeInbox({ id: row.id, leaseToken, now: new Date() });
        return { status: "processed", id: row.id, action: "authorized" };
      }

      // 3. Terminal failure statuses: REJECTED, DEADLINE_EXPIRED, CANCELED, REVERSED
      const isTerminalFailure =
        notifStatus === "REJECTED" ||
        notifStatus === "DEADLINE_EXPIRED" ||
        notifStatus === "CANCELED" ||
        notifStatus === "REVERSED";

      if (isTerminalFailure) {
        // CONFIRMED cannot regress
        if (currentSessionStatus === "captured") {
          this.logger_.warn(
            `tbank reconciler: ignored terminal failure ${notifStatus} for already captured payment ${row.payment_id}`,
          );
          await this.notificationService_.completeInbox({ id: row.id, leaseToken, now: new Date() });
          return { status: "processed", id: row.id, action: "ignored_captured_precedence" };
        }

        // Check for contradictory terminal events
        let resolvedStatus = notifStatus;
        const contradictions = await this.detectContradiction_(row, session);
        if (contradictions && this.tbankClient_) {
          try {
            const bankState = await this.tbankClient_.getState(row.payment_id);
            if (bankState.Status === "CONFIRMED") {
              // Bank reports payment is confirmed despite incoming failure notification!
              const projectionSuccess = await this.projectConfirmedPayment_(row, session);
              if (projectionSuccess.success) {
                await this.notificationService_.completeInbox({ id: row.id, leaseToken, now: new Date() });
                return { status: "processed", id: row.id, action: "contradiction_resolved_confirmed" };
              }
              await this.notificationService_.quarantineManualReview({
                id: row.id,
                leaseToken,
                now: new Date(),
              });
              return { status: "manual_review", id: row.id, reason: projectionSuccess.error ?? "Projection failed" };
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
            // Retry later
            await this.notificationService_.failInbox({ id: row.id, leaseToken, now: new Date() });
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

        await this.notificationService_.completeInbox({ id: row.id, leaseToken, now: new Date() });
        return { status: "processed", id: row.id, action: targetStatus };
      }

      // Non-terminal / unrecognized status (e.g. NEW, FORM_SHOWED)
      await this.notificationService_.completeInbox({ id: row.id, leaseToken, now: new Date() });
      return { status: "processed", id: row.id, action: "no_op" };
    } catch (processingError) {
      this.logger_.error(
        `tbank reconciler: unexpected error processing row ${row.id}: ${
          processingError instanceof Error ? processingError.message : String(processingError)
        }`,
      );
      await this.notificationService_.failInbox({ id: row.id, leaseToken, now: new Date() });
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
    const notifications = await this.notificationService_.listTbankNotifications({ id });
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
  async retryManualReview(id: string): Promise<void> {
    const now = new Date();
    await this.notificationService_.retryManualReview({ id, now });
    this.logger_.info(`tbank reconciler: operator reset manual review row ${id} to pending`);
  }

  /**
   * Operator method: Mark manual review row as resolved with audited reason.
   */
  async resolveManualReview(
    id: string,
    resolution: { reason: string; operatorId?: string },
  ): Promise<void> {
    const now = new Date();
    await this.notificationService_.resolveManualReview({ id, now });
    this.logger_.info(
      `tbank reconciler: operator ${resolution.operatorId ?? "unknown"} resolved manual review row ${id}: ${resolution.reason}`,
    );
  }
}

export default PaymentReconcilerService;
