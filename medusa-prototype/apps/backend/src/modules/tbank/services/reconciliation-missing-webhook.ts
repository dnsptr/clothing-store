import type { PaymentSessionDTO } from "@medusajs/types";

import type { PollAttemptRow } from "../../tbank-notifications/service";
import { TBANK_PAYMENT_PROVIDER_ID } from "../provider-id";
import { rublesToKopecks } from "../lib/money";
import type { ReconciliationServices, TbankNotificationStore } from "./reconciliation-contracts";
import { projectConfirmedPayment } from "./reconciliation-projection";
import { checkDurableLinkage, validateBankState } from "./reconciliation-trust";

export type PollResult = { readonly id: string; readonly status: "completed" | "retry" | "manual_review" | "stale" };
type PollStore = Required<Pick<TbankNotificationStore,
  "renewPaymentAttemptPoll" | "observePaymentAttemptPoll" | "finishPaymentAttemptPoll" | "listTbankNotifications">>;

class StalePollLeaseError extends Error {
  constructor() { super("T-Bank payment attempt polling lease expired"); }
}

function assertLease(rows: readonly unknown[]): void {
  if (rows.length === 0) throw new StalePollLeaseError();
}

function correlateAttempt(attempt: PollAttemptRow, session: PaymentSessionDTO, terminalKey: string): boolean {
  let amount: number;
  try { amount = rublesToKopecks(session.amount); } catch { return false; }
  return attempt.provider_id === TBANK_PAYMENT_PROVIDER_ID && session.provider_id === TBANK_PAYMENT_PROVIDER_ID &&
    attempt.terminal_key === terminalKey && attempt.payment_session_id === session.id &&
    attempt.order_id === session.id && session.data?.["orderId"] === attempt.order_id &&
    session.data?.["attemptId"] === attempt.id &&
    typeof session.data?.["paymentId"] === "string" && session.data["paymentId"].length > 0 &&
    attempt.currency_code.toLowerCase() === "rub" && session.currency_code.toLowerCase() === "rub" &&
    attempt.expected_amount_kopecks === amount;
}

export async function reconcileMissingWebhook(
  services: ReconciliationServices,
  attempt: PollAttemptRow,
  leaseToken: string,
  expectedPaymentId: string | undefined,
): Promise<PollResult> {
  const store = services.notifications as PollStore;
  const input = () => ({ id: attempt.id, leaseToken, now: new Date() });
  const renew = async () => assertLease(await store.renewPaymentAttemptPoll(input()));
  const around = async <T>(effect: () => Promise<T>): Promise<T> => {
    await renew();
    const result = await effect();
    await renew();
    return result;
  };
  const finish = async (outcome: "completed" | "retry" | "manual_review", reason?: string): Promise<PollResult> => {
    assertLease(await store.finishPaymentAttemptPoll({ ...input(), outcome, ...(reason ? { reason } : {}) }));
    const status = outcome === "retry" && attempt.poll_count >= 5 ? "manual_review" : outcome;
    if (status === "manual_review") {
      services.logger.error(`tbank.manual_review: payment attempt ${attempt.id}: ${reason ?? "poll attempts exhausted"}`);
    }
    return { id: attempt.id, status };
  };
  try {
    await renew();
    const session = await services.payment.retrievePaymentSession(attempt.payment_session_id);
    if (!correlateAttempt(attempt, session, services.expectedTerminalKey)) {
      return finish("manual_review", "Durable attempt and payment session correlation mismatch");
    }
    const paymentId = session.data!["paymentId"] as string;
    if (attempt.poll_payment_id && attempt.poll_payment_id !== paymentId) {
      return finish("manual_review", "Stored polling PaymentId differs from payment session");
    }
    if (!expectedPaymentId || paymentId !== expectedPaymentId) {
      return finish("retry", "PaymentId is not stable in the stored payment session");
    }
    // A signed CONFIRMED webhook owns its inbox row, even if the webhook worker has
    // not processed it yet. Polling must never impersonate or supersede that row.
    const existing = await store.listTbankNotifications({
      terminal_key: attempt.terminal_key, payment_id: paymentId, status: "CONFIRMED",
    });
    if (existing.length > 0) return finish("completed", "Authenticated CONFIRMED notification owns reconciliation");
    if (!services.bank) throw new Error("GetState client unavailable");
    const state = await around(() => services.bank!.getState(paymentId));
    const trust = validateBankState(state, {
      payment_id: paymentId, order_id: attempt.order_id,
      amount_kopecks: attempt.expected_amount_kopecks,
    }, services.expectedTerminalKey, true);
    if (!trust.valid) return finish("manual_review", trust.reason);
    assertLease(await store.observePaymentAttemptPoll({ ...input(), paymentId, status: state.Status! }));
    if (state.Status !== "CONFIRMED") {
      if (state.Status === "REJECTED" || state.Status === "DEADLINE_EXPIRED" ||
          state.Status === "CANCELED" || state.Status === "REVERSED" ||
          state.Status === "REFUNDED" || state.Status === "PARTIAL_REFUNDED") {
        return finish("manual_review", `GetState returned ${state.Status}; payment was not projected`);
      }
      // AUTHORIZED (and all intermediate states) is not captured and must not create an order.
      return finish("retry", `GetState returned ${state.Status}; awaiting CONFIRMED`);
    }
    const before = await checkDurableLinkage(services, session);
    if (before.paymentCaptured && !before.orderLinked) {
      return finish("retry", "Captured payment has no durable created-order linkage");
    }
    if (!before.paymentCaptured) {
      const latestSession = await services.payment.retrievePaymentSession(attempt.payment_session_id);
      if (!correlateAttempt(attempt, latestSession, services.expectedTerminalKey) ||
          latestSession.data?.["paymentId"] !== expectedPaymentId) {
        return finish("manual_review", "Payment session changed during GetState verification");
      }
      // Same bank PaymentId and deterministic workflow key as webhook processing.
      // Observation is committed first; a crash or expired lease remains auditable.
      const projection = await around(() => projectConfirmedPayment(services, {
        payment_id: paymentId, order_id: attempt.order_id,
        amount_kopecks: attempt.expected_amount_kopecks,
      }, session));
      if (!projection.success) return finish("retry", projection.error);
    }
    const after = await checkDurableLinkage(services, session);
    if (!after.paymentCaptured || !after.orderLinked || !after.orderId) {
      return finish("retry", "Confirmed capture and created-order linkage are not durable");
    }
    await around(() => services.events!.emit({ name: "tbank.order.paid", data: { id: after.orderId! } }));
    return finish("completed");
  } catch (error) {
    if (error instanceof StalePollLeaseError) return { id: attempt.id, status: "stale" };
    const reason = error instanceof Error ? error.message : String(error);
    try {
      const result = await finish("retry", reason);
      services.logger.warn(`tbank poll: attempt ${attempt.id}: ${reason}`);
      return result;
    } catch (leaseError) {
      if (leaseError instanceof StalePollLeaseError) return { id: attempt.id, status: "stale" };
      throw leaseError;
    }
  }
}
