import { randomUUID } from "crypto";
import { Modules } from "@medusajs/framework/utils";

import { TBANK_NOTIFICATION_MODULE } from "../../tbank-notifications";
import { parseTbankEnvironment } from "../config";
import { TBankClient } from "../lib/client";
import {
  inspectAttemptManualReview,
  inspectManualReview,
  resolveManualReview,
  retryManualReview,
  transitionAttemptManualReview,
  type AttemptManualReviewDetails,
  type OperatorAction,
} from "./manual-review-operations";
import { reconcileNotification } from "./reconcile-notification";
import { reconcileMissingWebhook, type PollResult } from "./reconciliation-missing-webhook";
import {
  parseNotificationRow,
  type DurableLinkageChecker,
  type ManualReviewDetails,
  type PaymentReconcilerDependencies,
  type ProcessBatchResult,
  type ProcessNotificationResult,
  type PaidOrderEvents,
  type QueryService,
  type ReconcilerWorkflowRunner,
  type ReconciliationServices,
  type TbankNotificationStore,
} from "./reconciliation-contracts";
import { LeaseController, StaleLeaseError } from "./reconciliation-lease";

export type {
  DurableLinkageChecker,
  ManualReviewDetails,
  PaymentReconcilerDependencies,
  ProcessBatchResult,
  ProcessNotificationResult,
  ReconcilerWorkflowRunner,
  TbankNotificationStore,
};
export { StaleLeaseError };

const IN_MEMORY_MUTEXES = new Map<string, Promise<void>>();

export class PaymentReconcilerConfigurationError extends Error {
  readonly name = "PaymentReconcilerConfigurationError";
  constructor(readonly dependency: string) {
    super(`Payment reconciler requires ${dependency}`);
  }
}

export class PaymentReconcilerService {
  private readonly services: ReconciliationServices;
  private readonly locking: PaymentReconcilerDependencies["locking"];
  private configuredServices?: ReconciliationServices;

  constructor(dependencies: PaymentReconcilerDependencies) {
    const container = dependencies.container;
    const logger = dependencies.logger ?? container?.resolve("logger");
    const notifications = dependencies.notifications ??
      container?.resolve<TbankNotificationStore>(TBANK_NOTIFICATION_MODULE);
    const payment = dependencies.payment ?? container?.resolve(Modules.PAYMENT);
    const query = dependencies.query ??
      container?.resolve<QueryService>("query", { allowUnregistered: true });
    const events = dependencies.events ?? container?.resolve<PaidOrderEvents>("event_bus");
    if (!logger) throw new PaymentReconcilerConfigurationError("logger");
    if (!notifications) throw new PaymentReconcilerConfigurationError("TbankNotificationModuleService");
    if (!payment) throw new PaymentReconcilerConfigurationError("PaymentModuleService");
    this.locking = dependencies.locking ??
      container?.resolve(Modules.LOCKING, { allowUnregistered: true });
    this.services = {
      logger,
      notifications,
      payment,
      expectedTerminalKey: dependencies.expectedTerminalKey ?? "",
      ...(dependencies.tbankClient ? { bank: dependencies.tbankClient } : {}),
      ...(dependencies.workflowRunner ? { workflow: dependencies.workflowRunner } : {}),
      ...(dependencies.durableLinkageChecker ? { linkageChecker: dependencies.durableLinkageChecker } : {}),
      ...(events ? { events } : {}),
      ...(query ? { query } : {}),
      ...(container ? { container } : {}),
    };
  }

  private forReconciliation(): ReconciliationServices {
    if (this.configuredServices) return this.configuredServices;
    if (this.services.bank && this.services.expectedTerminalKey) return this.services;
    const config = parseTbankEnvironment(process.env);
    if (!config.enabled) return this.services;
    this.configuredServices = {
      ...this.services,
      expectedTerminalKey: this.services.expectedTerminalKey || config.options.terminalKey,
      bank: this.services.bank ?? new TBankClient({
        terminalKey: config.options.terminalKey,
        password: config.options.password,
        apiBaseUrl: config.options.apiBaseUrl,
      }),
    };
    return this.configuredServices;
  }

  private async withPaymentLock<T>(paymentId: string, operation: () => Promise<T>): Promise<T> {
    const key = `tbank:payment:${paymentId}`;
    if (this.locking?.execute) return this.locking.execute(key, operation, { timeout: 30 });
    const current = IN_MEMORY_MUTEXES.get(key) ?? Promise.resolve();
    let release: () => void = () => undefined;
    const next = new Promise<void>((resolve) => { release = resolve; });
    const queued = current.then(() => next);
    IN_MEMORY_MUTEXES.set(key, queued);
    await current;
    try {
      return await operation();
    } finally {
      release();
      if (IN_MEMORY_MUTEXES.get(key) === queued) IN_MEMORY_MUTEXES.delete(key);
    }
  }

  async processNotification(id: string): Promise<ProcessNotificationResult> {
    const services = this.forReconciliation();
    const leaseToken = randomUUID();
    const rows = await this.services.notifications.claimNotificationById({ id, leaseToken, now: new Date() });
    const claimed = rows[0];
    if (!claimed) return { status: "not_claimed", id };
    const row = parseNotificationRow(claimed);
    return this.withPaymentLock(row.payment_id, () => reconcileNotification(services, row, leaseToken));
  }

  async processPendingBatch(limit = 10): Promise<ProcessBatchResult> {
    const services = this.forReconciliation();
    const leaseToken = randomUUID();
    const now = new Date();
    const exhausted = await this.services.notifications.quarantineExpiredExhausted({ now });
    for (const row of exhausted) {
      this.services.logger.error(`tbank.manual_review: ${String(row["id"])}: expired lease exhausted retries`);
    }
    const rows = await this.services.notifications.claimInbox({ limit, leaseToken, now });
    const results: ProcessNotificationResult[] = [];
    for (const claimed of rows) {
      const row = parseNotificationRow(claimed);
      const result = await this.withPaymentLock(row.payment_id, async () => {
        const lease = new LeaseController(this.services.notifications, row.id, leaseToken);
        try {
          await lease.renew();
        } catch (error) {
          if (error instanceof StaleLeaseError) {
            return { status: "ignored", id: row.id, reason: "stale_lease_fenced" } satisfies ProcessNotificationResult;
          }
          const failed = await lease.fail();
          if (failed.lifecycle_state === "manual_review") {
            this.services.logger.error(`tbank.manual_review: ${row.id}: lease renewal retries exhausted`);
            return { status: "manual_review", id: row.id, reason: "Lease renewal retries exhausted" } satisfies ProcessNotificationResult;
          }
          return { status: "retry_scheduled", id: row.id, error: error instanceof Error ? error.message : String(error) } satisfies ProcessNotificationResult;
        }
        return reconcileNotification(services, row, leaseToken);
      });
      results.push(result);
    }
    return { claimed: rows.length, results };
  }

  async processMissingWebhookBatch(limit = 5): Promise<{ readonly claimed: number; readonly results: readonly PollResult[] }> {
    const services = this.forReconciliation();
    if (!services.bank) return { claimed: 0, results: [] };
    // A distributed lock is mandatory: webhook and poll workers may run in
    // separate processes, and both must enter the same per-payment critical section.
    if (!this.locking?.execute) throw new PaymentReconcilerConfigurationError("distributed payment locking");
    if (!services.events || (!services.workflow && !services.container) ||
        (!services.query && !services.linkageChecker)) {
      throw new PaymentReconcilerConfigurationError("order/payment workflow, linkage and paid-order events");
    }
    const store = services.notifications;
    if (!store.claimDuePaymentAttempts || !store.renewPaymentAttemptPoll ||
        !store.observePaymentAttemptPoll || !store.finishPaymentAttemptPoll ||
        !store.listTbankNotifications) {
      throw new PaymentReconcilerConfigurationError("durable attempt polling store");
    }
    const leaseToken = randomUUID();
    const attempts = await store.claimDuePaymentAttempts({ limit, leaseToken, now: new Date() });
    const results: PollResult[] = [];
    for (const attempt of attempts) {
      // The session's paymentId is not stored in the attempt (pre-Init insert).
      // Serialize by session until it has passed correlation; the webhook uses
      // the bank paymentId, so the workflow key also fences any late webhook.
      const session = await services.payment.retrievePaymentSession(attempt.payment_session_id).catch(() => null);
      const paymentId = session?.data?.["paymentId"];
      const key = typeof paymentId === "string" && paymentId.length > 0 ? paymentId : attempt.id;
      results.push(await this.withPaymentLock(key, () =>
        reconcileMissingWebhook(services, attempt, leaseToken,
          typeof paymentId === "string" && paymentId.length > 0 ? paymentId : undefined)));
    }
    return { claimed: attempts.length, results };
  }

  inspectManualReview(id: string): Promise<ManualReviewDetails> {
    return inspectManualReview(this.services.notifications, this.services.payment, id);
  }

  inspectAttemptManualReview(id: string): Promise<AttemptManualReviewDetails> {
    return inspectAttemptManualReview(this.services.notifications, this.services.payment, id);
  }

  async retryManualReview(id: string, action: OperatorAction): Promise<void> {
    if (id.startsWith("tbatt_")) {
      await transitionAttemptManualReview(this.services.notifications, id, action, "pending");
    } else {
      await retryManualReview(this.services.notifications, id, action);
    }
    this.services.logger.info(`tbank.manual_review.retry: ${id}: ${action.operatorId}: ${action.reason}`);
  }

  async resolveManualReview(id: string, action: OperatorAction): Promise<void> {
    if (id.startsWith("tbatt_")) {
      await transitionAttemptManualReview(this.services.notifications, id, action, "completed");
    } else {
      await resolveManualReview(this.services.notifications, id, action);
    }
    this.services.logger.info(`tbank.manual_review.resolve: ${id}: ${action.operatorId}: ${action.reason}`);
  }
}

export default PaymentReconcilerService;
