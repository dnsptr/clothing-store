import { randomUUID } from "crypto";
import { Modules } from "@medusajs/framework/utils";

import { TBANK_NOTIFICATION_MODULE } from "../../tbank-notifications";
import { parseTbankEnvironment } from "../config";
import { TBankClient } from "../lib/client";
import {
  inspectManualReview,
  resolveManualReview,
  retryManualReview,
  type OperatorAction,
} from "./manual-review-operations";
import { reconcileNotification } from "./reconcile-notification";
import {
  parseNotificationRow,
  type DurableLinkageChecker,
  type ManualReviewDetails,
  type PaymentReconcilerDependencies,
  type ProcessBatchResult,
  type ProcessNotificationResult,
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

  constructor(dependencies: PaymentReconcilerDependencies) {
    const container = dependencies.container;
    const logger = dependencies.logger ?? container?.resolve("logger");
    const notifications = dependencies.notifications ??
      container?.resolve<TbankNotificationStore>(TBANK_NOTIFICATION_MODULE);
    const payment = dependencies.payment ?? container?.resolve(Modules.PAYMENT);
    const query = dependencies.query ??
      container?.resolve<QueryService>("query", { allowUnregistered: true });
    let bank = dependencies.tbankClient;
    let expectedTerminalKey = dependencies.expectedTerminalKey;
    if (!bank || !expectedTerminalKey) {
      const config = parseTbankEnvironment(process.env);
      if (config.enabled) {
        expectedTerminalKey = expectedTerminalKey ?? config.options.terminalKey;
        bank = bank ?? new TBankClient({
          terminalKey: config.options.terminalKey,
          password: config.options.password,
          apiBaseUrl: config.options.apiBaseUrl,
        });
      }
    }
    if (!logger) throw new PaymentReconcilerConfigurationError("logger");
    if (!notifications) throw new PaymentReconcilerConfigurationError("TbankNotificationModuleService");
    if (!payment) throw new PaymentReconcilerConfigurationError("PaymentModuleService");
    this.locking = dependencies.locking ??
      container?.resolve(Modules.LOCKING, { allowUnregistered: true });
    this.services = {
      logger,
      notifications,
      payment,
      expectedTerminalKey: expectedTerminalKey ?? "",
      ...(bank ? { bank } : {}),
      ...(dependencies.workflowRunner ? { workflow: dependencies.workflowRunner } : {}),
      ...(dependencies.durableLinkageChecker ? { linkageChecker: dependencies.durableLinkageChecker } : {}),
      ...(query ? { query } : {}),
      ...(container ? { container } : {}),
    };
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
    const leaseToken = randomUUID();
    const rows = await this.services.notifications.claimNotificationById({ id, leaseToken, now: new Date() });
    const claimed = rows[0];
    if (!claimed) return { status: "not_claimed", id };
    const row = parseNotificationRow(claimed);
    return this.withPaymentLock(row.payment_id, () => reconcileNotification(this.services, row, leaseToken));
  }

  async processPendingBatch(limit = 10): Promise<ProcessBatchResult> {
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
        return reconcileNotification(this.services, row, leaseToken);
      });
      results.push(result);
    }
    return { claimed: rows.length, results };
  }

  inspectManualReview(id: string): Promise<ManualReviewDetails> {
    return inspectManualReview(this.services.notifications, this.services.payment, id);
  }

  async retryManualReview(id: string, action: OperatorAction): Promise<void> {
    await retryManualReview(this.services.notifications, id, action);
    this.services.logger.info(`tbank.manual_review.retry: ${id}: ${action.operatorId}: ${action.reason}`);
  }

  async resolveManualReview(id: string, action: OperatorAction): Promise<void> {
    await resolveManualReview(this.services.notifications, id, action);
    this.services.logger.info(`tbank.manual_review.resolve: ${id}: ${action.operatorId}: ${action.reason}`);
  }
}

export default PaymentReconcilerService;
