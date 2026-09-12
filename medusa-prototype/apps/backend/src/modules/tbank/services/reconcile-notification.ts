import type { PaymentSessionDTO } from "@medusajs/types";

import type { NotificationRow, ProcessNotificationResult, ReconciliationServices } from "./reconciliation-contracts";
import { LeaseController, StaleLeaseError } from "./reconciliation-lease";
import { projectConfirmedPayment } from "./reconciliation-projection";
import { checkDurableLinkage, correlateRow, validateBankState } from "./reconciliation-trust";

const FAILURE_STATUSES = ["REJECTED", "DEADLINE_EXPIRED", "CANCELED", "REVERSED"] as const;

class BankStateUnavailableError extends Error {
  readonly name = "BankStateUnavailableError";
  constructor() {
    super("T-Bank GetState client is unavailable for contradictory notification");
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function scheduleRetry(
  services: ReconciliationServices,
  row: NotificationRow,
  lease: LeaseController,
  error: unknown,
): Promise<ProcessNotificationResult> {
  const message = errorMessage(error);
  const failed = await lease.fail();
  if (failed.lifecycle_state === "manual_review") {
    services.logger.error(`tbank.manual_review: ${row.id}: exhausted retries: ${message}`);
    return { status: "manual_review", id: row.id, reason: `Exhausted retries: ${message}` };
  }
  return { status: "retry_scheduled", id: row.id, error: message };
}

async function quarantineConflict(
  services: ReconciliationServices,
  row: NotificationRow,
  lease: LeaseController,
  reason: string,
): Promise<ProcessNotificationResult> {
  await lease.renew();
  if (services.notifications.createTbankNotificationConflicts) {
    await services.notifications.createTbankNotificationConflicts({
      canonical_notification_id: row.id,
      terminal_key: row.terminal_key,
      payment_id: row.payment_id,
      status: row.status,
      canonical_payload_hash: row.canonical_payload_hash ?? null,
      conflicting_payload_hash: row.canonical_payload_hash ?? "",
      conflict_kind: "correlation_mismatch",
      correlation_failures: reason,
      lifecycle_state: "manual_review",
    });
  }
  await lease.quarantine();
  services.logger.error(`tbank.manual_review: ${row.id}: ${reason}`);
  return { status: "manual_review", id: row.id, reason };
}

async function handleConfirmed(
  services: ReconciliationServices,
  row: NotificationRow,
  session: PaymentSessionDTO,
  lease: LeaseController,
  action: "captured_projected" | "contradiction_resolved_confirmed",
): Promise<ProcessNotificationResult> {
  const before = await checkDurableLinkage(services, session);
  if (before.paymentCaptured && before.orderLinked) {
    await lease.complete();
    return { status: "processed", id: row.id, action: "already_captured" };
  }
  if (before.paymentCaptured) {
    return scheduleRetry(services, row, lease, new Error("Captured payment has no durable created-order linkage"));
  }
  const projection = await lease.around(() => projectConfirmedPayment(services, row, session));
  if (!projection.success) return scheduleRetry(services, row, lease, new Error(projection.error));
  const after = await checkDurableLinkage(services, session);
  if (!after.paymentCaptured || !after.orderLinked) {
    return scheduleRetry(
      services,
      row,
      lease,
      new Error(after.paymentCaptured ? "Payment captured but order creation is not durably linked" : "Payment capture is not durable"),
    );
  }
  await lease.complete();
  return { status: "processed", id: row.id, action };
}

async function handleAuthorized(
  services: ReconciliationServices,
  row: NotificationRow,
  session: PaymentSessionDTO,
  lease: LeaseController,
): Promise<ProcessNotificationResult> {
  const action = await lease.around(async () => {
    const currentSession = await services.payment.retrievePaymentSession(session.id);
    if (currentSession.status === "captured") return "ignored_captured_precedence" as const;
    await services.payment.updatePaymentSession({
      id: currentSession.id,
      data: { ...(currentSession.data ?? {}), status: "AUTHORIZED" },
      currency_code: currentSession.currency_code,
      amount: currentSession.amount,
      status: "pending",
    });
    return "authorized" as const;
  });
  await lease.complete();
  return { status: "processed", id: row.id, action };
}

async function hasContradiction(
  services: ReconciliationServices,
  row: NotificationRow,
  session: PaymentSessionDTO,
): Promise<boolean> {
  if (session.status === "authorized" || session.status === "captured") return true;
  if (!services.notifications.listTbankNotifications) return false;
  const related = await services.notifications.listTbankNotifications({ payment_id: row.payment_id });
  return related.some((notification) =>
    notification["id"] !== row.id &&
    (notification["status"] === "CONFIRMED" || notification["status"] === "AUTHORIZED"));
}

async function handleFailure(
  services: ReconciliationServices,
  row: NotificationRow,
  session: PaymentSessionDTO,
  lease: LeaseController,
): Promise<ProcessNotificationResult> {
  let status = row.status;
  if (await hasContradiction(services, row, session)) {
    const bank = services.bank;
    if (!bank) throw new BankStateUnavailableError();
    const bankState = await lease.around(() => bank.getState(row.payment_id));
    const trust = validateBankState(bankState, row, services.expectedTerminalKey);
    if (!trust.valid) return quarantineConflict(services, row, lease, trust.reason);
    status = bankState.Status ?? "";
    if (status === "CONFIRMED") {
      return handleConfirmed(services, row, session, lease, "contradiction_resolved_confirmed");
    }
    if (status === "AUTHORIZED") return handleAuthorized(services, row, session, lease);
  }
  if (session.status === "captured") {
    return quarantineConflict(
      services,
      row,
      lease,
      `Bank terminal failure ${status} contradicts captured Medusa state`,
    );
  }
  const targetStatus = status === "CANCELED" || status === "REVERSED" ? "canceled" : "error";
  await lease.around(() => services.payment.updatePaymentSession({
    id: session.id,
    data: { ...(session.data ?? {}), status },
    currency_code: session.currency_code,
    amount: session.amount,
    status: targetStatus,
  }));
  await lease.complete();
  return { status: "processed", id: row.id, action: targetStatus };
}

export async function reconcileNotification(
  services: ReconciliationServices,
  row: NotificationRow,
  leaseToken: string,
): Promise<ProcessNotificationResult> {
  const lease = new LeaseController(services.notifications, row.id, leaseToken);
  try {
    const session = await services.payment.retrievePaymentSession(row.order_id);
    const correlation = correlateRow(row, session, services.expectedTerminalKey);
    if (!correlation.valid) return await quarantineConflict(services, row, lease, correlation.reason);
    if (row.status === "CONFIRMED") {
      return await handleConfirmed(services, row, session, lease, "captured_projected");
    }
    if (row.status === "AUTHORIZED") {
      return await handleAuthorized(services, row, session, lease);
    }
    if (FAILURE_STATUSES.some((status) => status === row.status)) {
      return await handleFailure(services, row, session, lease);
    }
    await lease.complete();
    return { status: "processed", id: row.id, action: "no_op" };
  } catch (error) {
    if (error instanceof StaleLeaseError) {
      services.logger.warn(`tbank reconciler: stale lease fenced for ${row.id}`);
      return { status: "ignored", id: row.id, reason: "stale_lease_fenced" };
    }
    return await scheduleRetry(services, row, lease, error);
  }
}
