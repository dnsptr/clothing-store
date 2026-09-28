import type { PaymentSessionDTO } from "@medusajs/types";

import { TBANK_PAYMENT_PROVIDER_ID } from "../provider-id";
import { rublesToKopecks } from "../lib/money";
import type {
  PaymentAttemptPollRow,
  PollPaymentAttemptResult,
  ReconciliationServices,
  TbankNotificationStore,
} from "./reconciliation-contracts";
import { StaleLeaseError } from "./reconciliation-lease";
import { projectConfirmedPayment } from "./reconciliation-projection";
import { checkDurableLinkage, validateBankState } from "./reconciliation-trust";

const PENDING_STATUSES = ["NEW", "FORM_SHOWED", "AUTHORIZING", "3DS_CHECKING"] as const;
const FAILURE_STATUSES = ["REJECTED", "DEADLINE_EXPIRED", "CANCELED", "REVERSED"] as const;

class PollLease {
  constructor(
    private readonly store: TbankNotificationStore,
    readonly id: string,
    private readonly token: string,
  ) {}

  private requireMutation<T>(rows: readonly T[]): T {
    if (rows.length === 0) throw new StaleLeaseError(this.id);
    return rows[0]!;
  }

  async renew(): Promise<void> {
    this.requireMutation(await this.store.renewPaymentAttemptPollLease({
      id: this.id, leaseToken: this.token, now: new Date(),
    }));
  }

  async complete(): Promise<void> {
    this.requireMutation(await this.store.completePaymentAttemptPoll({
      id: this.id, leaseToken: this.token, now: new Date(),
    }));
  }

  async defer(): Promise<void> {
    this.requireMutation(await this.store.deferPaymentAttemptPoll({
      id: this.id, leaseToken: this.token, now: new Date(),
    }));
  }

  async fail(): Promise<string> {
    return this.requireMutation(await this.store.failPaymentAttemptPoll({
      id: this.id, leaseToken: this.token, now: new Date(),
    })).poll_state;
  }

  async quarantine(): Promise<void> {
    this.requireMutation(await this.store.quarantinePaymentAttemptPoll({
      id: this.id, leaseToken: this.token, now: new Date(),
    }));
  }

  async around<T>(sideEffect: () => Promise<T>): Promise<T> {
    await this.renew();
    const result = await sideEffect();
    await this.renew();
    return result;
  }
}

async function publishPaidOrder(
  services: ReconciliationServices,
  lease: PollLease,
  orderId?: string,
): Promise<void> {
  const events = services.events;
  if (!events) return;
  if (!orderId) throw new Error("Captured payment has no durable order ID for notifications");
  await lease.around(() => events.emit({
    name: "tbank.order.paid",
    data: { id: orderId },
  }));
}

async function retry(
  services: ReconciliationServices,
  lease: PollLease,
  error: unknown,
): Promise<PollPaymentAttemptResult> {
  const message = error instanceof Error ? error.message : String(error);
  const state = await lease.fail();
  if (state === "manual_review") {
    services.logger.error(`tbank.manual_review: payment attempt ${lease.id}: exhausted poll retries: ${message}`);
    return { status: "manual_review", id: lease.id, reason: `Exhausted poll retries: ${message}` };
  }
  return { status: "retry_scheduled", id: lease.id, error: message };
}

async function quarantine(
  services: ReconciliationServices,
  lease: PollLease,
  reason: string,
): Promise<PollPaymentAttemptResult> {
  await lease.quarantine();
  services.logger.error(`tbank.manual_review: payment attempt ${lease.id}: ${reason}`);
  return { status: "manual_review", id: lease.id, reason };
}

export function correlateAttempt(
  attempt: PaymentAttemptPollRow,
  session: PaymentSessionDTO,
  expectedTerminalKey: string,
  paymentId: string,
): string | null {
  const mismatches: string[] = [];
  if (attempt.provider_id !== TBANK_PAYMENT_PROVIDER_ID || session.provider_id !== attempt.provider_id) mismatches.push("provider");
  if (attempt.terminal_key !== expectedTerminalKey) mismatches.push("terminal");
  if (attempt.payment_session_id !== session.id || attempt.order_id !== session.id || session.data?.["orderId"] !== attempt.order_id) mismatches.push("OrderId");
  if (session.data?.["paymentId"] !== paymentId) mismatches.push("PaymentId");
  if (attempt.currency_code.toLowerCase() !== "rub" || session.currency_code.toLowerCase() !== attempt.currency_code.toLowerCase()) mismatches.push("currency");
  try {
    if (attempt.expected_amount_kopecks !== rublesToKopecks(session.amount)) mismatches.push("amount");
  } catch {
    mismatches.push("amount");
  }
  return mismatches.length ? `Payment attempt correlation mismatch: ${mismatches.join(", ")}` : null;
}

async function handleConfirmed(
  services: ReconciliationServices,
  attempt: PaymentAttemptPollRow,
  session: PaymentSessionDTO,
  paymentId: string,
  lease: PollLease,
): Promise<PollPaymentAttemptResult> {
  const linkage = await checkDurableLinkage(services, session);
  if (linkage.paymentCaptured && linkage.orderLinked) {
    await publishPaidOrder(services, lease, linkage.orderId);
    await lease.complete();
    return { status: "processed", id: attempt.id, action: "already_captured" };
  }
  if (session.status === "captured" || linkage.paymentCaptured || linkage.orderLinked) {
    return retry(services, lease, new Error("Payment and created order are not both durably linked"));
  }
  // Never use projectConfirmedPayment's test-only session-only fallback in production polling.
  if (!services.workflow && !services.container) {
    return retry(services, lease, new Error("Captured payment workflow is unavailable"));
  }
  const projected = await lease.around(() => projectConfirmedPayment(services, {
    payment_id: paymentId,
    order_id: attempt.order_id,
    amount_kopecks: attempt.expected_amount_kopecks,
  }, session));
  if (!projected.success) return retry(services, lease, new Error(projected.error));
  const after = await checkDurableLinkage(services, session);
  if (!after.paymentCaptured || !after.orderLinked) {
    return retry(services, lease, new Error("Payment capture and created-order linkage are not both durable"));
  }
  await publishPaidOrder(services, lease, after.orderId);
  await lease.complete();
  return { status: "processed", id: attempt.id, action: "captured_projected" };
}

export async function reconcilePaymentAttempt(
  services: ReconciliationServices,
  attempt: PaymentAttemptPollRow,
  leaseToken: string,
  withPaymentLock: <T>(paymentId: string, operation: () => Promise<T>) => Promise<T>,
): Promise<PollPaymentAttemptResult> {
  const lease = new PollLease(services.notifications, attempt.id, leaseToken);
  try {
    const initial = await services.payment.retrievePaymentSession(attempt.payment_session_id);
    const paymentId = initial.data?.["paymentId"];
    if (paymentId === undefined || paymentId === null || paymentId === "") {
      await lease.defer();
      return { status: "deferred", id: attempt.id, reason: "PaymentId is not yet recorded in the payment session" };
    }
    if (typeof paymentId !== "string") {
      return await quarantine(services, lease, "Payment session PaymentId is not a string");
    }
    return await withPaymentLock(paymentId, async (): Promise<PollPaymentAttemptResult> => {
      await lease.renew();
      // Re-read under the same PaymentId lock used by notification reconciliation.
      const session = await services.payment.retrievePaymentSession(attempt.payment_session_id);
      const mismatch = correlateAttempt(attempt, session, services.expectedTerminalKey, paymentId);
      if (mismatch) return quarantine(services, lease, mismatch);
      const before = await checkDurableLinkage(services, session);
      if (before.paymentCaptured && before.orderLinked) {
        await publishPaidOrder(services, lease, before.orderId);
        await lease.complete();
        return { status: "processed", id: attempt.id, action: "already_captured" };
      }
      const bank = services.bank;
      if (!bank) throw new Error("T-Bank GetState client is unavailable");
      const bankState = await lease.around(() => bank.getState(paymentId));
      if (bankState.Success !== true) throw new Error("T-Bank GetState did not succeed");
      const trust = validateBankState(bankState, {
        payment_id: paymentId,
        order_id: attempt.order_id,
        amount_kopecks: attempt.expected_amount_kopecks,
      }, services.expectedTerminalKey, true);
      if (!trust.valid) return quarantine(services, lease, trust.reason);
      const status = bankState.Status!;
      if (FAILURE_STATUSES.some((failure) => failure === status) && (session.status === "captured" || before.paymentCaptured)) {
        return quarantine(services, lease, `Bank terminal failure ${status} contradicts captured Medusa state`);
      }
      if (session.status === "captured" || before.paymentCaptured) {
        return retry(services, lease, new Error("Captured payment has no durable created-order linkage"));
      }
      if (PENDING_STATUSES.some((pending) => pending === status)) {
        await lease.defer();
        return { status: "deferred", id: attempt.id, reason: `Bank payment remains ${status}` };
      }
      if (status === "CONFIRMED") {
        const current = await lease.around(() => services.payment.retrievePaymentSession(session.id));
        const currentMismatch = correlateAttempt(attempt, current, services.expectedTerminalKey, paymentId);
        if (currentMismatch) return quarantine(services, lease, currentMismatch);
        return handleConfirmed(services, attempt, current, paymentId, lease);
      }
      // Check freshly before any session mutation: the webhook may have captured it meanwhile.
      const current = await lease.around(() => services.payment.retrievePaymentSession(session.id));
      const currentMismatch = correlateAttempt(attempt, current, services.expectedTerminalKey, paymentId);
      if (currentMismatch) return quarantine(services, lease, currentMismatch);
      const latestLinkage = await checkDurableLinkage(services, current);
      if (current.status === "captured" || latestLinkage.paymentCaptured) {
        if (FAILURE_STATUSES.some((failure) => failure === status) && !latestLinkage.orderLinked) {
          return quarantine(services, lease, `Bank terminal failure ${status} contradicts captured Medusa state`);
        }
        if (!latestLinkage.paymentCaptured || !latestLinkage.orderLinked) {
          return retry(services, lease, new Error("Captured payment has no durable created-order linkage"));
        }
        await publishPaidOrder(services, lease, latestLinkage.orderId);
        await lease.complete();
        return { status: "processed", id: attempt.id, action: "already_captured" };
      }
      const targetStatus = status === "AUTHORIZED" ? "pending" :
        status === "CANCELED" || status === "REVERSED" ? "canceled" : "error";
      await lease.around(() => services.payment.updatePaymentSession({
        id: current.id,
        data: { ...(current.data ?? {}), status },
        currency_code: current.currency_code,
        amount: current.amount,
        status: targetStatus,
      }));
      if (status === "AUTHORIZED") {
        await lease.defer();
        return { status: "deferred", id: attempt.id, reason: "Bank payment remains AUTHORIZED" };
      }
      await lease.complete();
      return { status: "processed", id: attempt.id, action: targetStatus };
    });
  } catch (error) {
    if (error instanceof StaleLeaseError) {
      services.logger.warn(`tbank poll: stale lease fenced for payment attempt ${attempt.id}`);
      return { status: "ignored", id: attempt.id, reason: "stale_lease_fenced" };
    }
    try {
      return await retry(services, lease, error);
    } catch (failure) {
      if (failure instanceof StaleLeaseError) {
        services.logger.warn(`tbank poll: stale lease fenced for payment attempt ${attempt.id}`);
        return { status: "ignored", id: attempt.id, reason: "stale_lease_fenced" };
      }
      throw failure;
    }
  }
}
