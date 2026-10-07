import type { PaymentSessionDTO } from "@medusajs/types";
import type { TBankGetStateResult } from "../lib/client";

import { correlateAttempt } from "./reconcile-payment-attempt";
import { checkDurableLinkage, validateBankState } from "./reconciliation-trust";
import type { PaymentAttemptPollRow, ReconciliationServices } from "./reconciliation-contracts";
import type { OperatorAction } from "./manual-review-operations";

type Source = Readonly<Record<string, unknown>>;
export type PollOperatorAction = {
  readonly id: string;
  readonly action: "retry" | "resolve";
  readonly operator_id: string;
  readonly reason: string;
  readonly created_at: Date;
};
export type PollManualReviewDetails = {
  readonly paymentAttempt: Source;
  readonly paymentSession: PaymentSessionDTO | null;
  readonly actions: readonly PollOperatorAction[];
};
export type PollReviewAction = OperatorAction & { readonly expectedReviewAt: Date };
export type PollReviewStore = {
  listTbankPaymentAttempts(filters: Record<string, unknown>, config?: Record<string, unknown>): Promise<readonly Source[]>;
  listPollReviewActions(id: string): Promise<readonly PollOperatorAction[]>;
  retryPaymentAttemptManualReview(input: PollReviewAction & { readonly id: string; readonly now: Date; readonly terminalKey: string }): Promise<readonly unknown[]>;
  resolvePaymentAttemptManualReview(input: PollReviewAction & { readonly id: string; readonly now: Date }): Promise<readonly unknown[]>;
};

export class PollReviewNotFoundError extends Error {
  readonly name = "PollReviewNotFoundError";
  constructor(id: string) { super(`Payment attempt ${id} was not found`); }
}
export class PollReviewStateError extends Error {
  readonly name: string = "PollReviewStateError";
  constructor(id: string, reason = "not in manual review or no longer current") {
    super(`Payment attempt ${id}: ${reason}`);
  }
}

function isNotFound(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const value = error as Record<string, unknown>;
  return value["type"] === "not_found" || value["code"] === "NOT_FOUND" || value["status"] === 404;
}

async function findAttempt(store: PollReviewStore, id: string): Promise<Source> {
  const [attempt] = await store.listTbankPaymentAttempts({ id }, { take: 1 });
  if (!attempt) throw new PollReviewNotFoundError(id);
  if (attempt["poll_state"] !== "manual_review") throw new PollReviewStateError(id);
  return attempt;
}

export async function inspectPollReview(
  store: PollReviewStore,
  services: ReconciliationServices,
  id: string,
): Promise<PollManualReviewDetails> {
  const paymentAttempt = await findAttempt(store, id);
  const sessionId = paymentAttempt["payment_session_id"];
  let paymentSession: PaymentSessionDTO | null = null;
  if (typeof sessionId === "string") {
    try {
      paymentSession = await services.payment.retrievePaymentSession(sessionId);
    } catch (error) {
      if (!isNotFound(error)) throw error;
    }
  }
  const actions = await store.listPollReviewActions(id);
  return { paymentAttempt, paymentSession, actions };
}

export async function retryPollReview(
  store: PollReviewStore,
  id: string,
  action: PollReviewAction,
  currentTerminalKey: string,
): Promise<void> {
  // The conditional UPDATE, not this read, decides which competing operator wins.
  const attempt = await findAttempt(store, id);
  if (!currentTerminalKey || attempt["terminal_key"] !== currentTerminalKey) {
    throw new PollReviewStateError(id, "the original terminal is not active; the case remains in manual review");
  }
  const reviewAt = attempt["poll_manual_review_at"];
  if (!(reviewAt instanceof Date) || reviewAt.getTime() !== action.expectedReviewAt.getTime()) {
    throw new PollReviewStateError(id, "a newer review must be inspected before retrying");
  }
  const rows = await store.retryPaymentAttemptManualReview({
    id, now: new Date(), operatorId: action.operatorId, reason: action.reason,
    expectedReviewAt: action.expectedReviewAt, terminalKey: currentTerminalKey,
  });
  if (rows.length === 0) throw new PollReviewStateError(id);
}

export async function resolvePollReview(
  store: PollReviewStore,
  services: ReconciliationServices,
  id: string,
  action: PollReviewAction,
  withPaymentLock: <T>(paymentId: string, operation: () => Promise<T>) => Promise<T>,
): Promise<void> {
  const attempt = await findAttempt(store, id);
  const inspectedAt = attempt["poll_manual_review_at"];
  if (!(inspectedAt instanceof Date) || inspectedAt.getTime() !== action.expectedReviewAt.getTime()) {
    throw new PollReviewStateError(id, "a newer review must be inspected before resolving");
  }
  const sessionId = attempt["payment_session_id"];
  if (typeof sessionId !== "string") throw new PollReviewStateError(id, "payment session is missing");
  let initial: PaymentSessionDTO;
  try {
    initial = await services.payment.retrievePaymentSession(sessionId);
  } catch (error) {
    if (isNotFound(error)) throw new PollReviewStateError(id, "payment session is missing");
    throw error;
  }
  const paymentId = initial.data?.["paymentId"];
  if (typeof paymentId !== "string" || paymentId.length === 0) {
    throw new PollReviewStateError(id, "bank PaymentId is missing");
  }
  await withPaymentLock(paymentId, async () => {
    const current = await findAttempt(store, id);
    const reviewAt = current["poll_manual_review_at"];
    if (!(reviewAt instanceof Date) || !Number.isFinite(reviewAt.getTime())) {
      throw new PollReviewStateError(id, "review epoch is missing");
    }
    if (reviewAt.getTime() !== action.expectedReviewAt.getTime()) {
      throw new PollReviewStateError(id, "a newer review must be inspected before resolving");
    }
    let session: PaymentSessionDTO;
    try {
      session = await services.payment.retrievePaymentSession(sessionId);
    } catch (error) {
      if (isNotFound(error)) throw new PollReviewStateError(id, "payment session is missing");
      throw error;
    }
    const mismatch = correlateAttempt(current as unknown as PaymentAttemptPollRow, session, services.expectedTerminalKey, paymentId);
    if (mismatch) throw new PollReviewStateError(id, mismatch);
    if (!services.bank || !services.expectedTerminalKey) {
      throw new PollReviewStateError(id, "bank GetState is unavailable");
    }
    let bankState: TBankGetStateResult;
    try {
      bankState = await services.bank.getState(paymentId);
    } catch {
      throw new PollReviewStateError(id, "bank GetState failed");
    }
    const trust = validateBankState(bankState, {
      payment_id: paymentId,
      order_id: current["order_id"] as string,
      amount_kopecks: current["expected_amount_kopecks"] as number,
    }, services.expectedTerminalKey);
    if (!trust.valid || bankState.Status !== "CONFIRMED") {
      throw new PollReviewStateError(id, trust.valid ? "bank payment is not CONFIRMED" : trust.reason);
    }
    let latestSession: PaymentSessionDTO;
    try {
      latestSession = await services.payment.retrievePaymentSession(sessionId);
    } catch (error) {
      if (isNotFound(error)) throw new PollReviewStateError(id, "payment session is missing");
      throw error;
    }
    const latestMismatch = correlateAttempt(current as unknown as PaymentAttemptPollRow, latestSession, services.expectedTerminalKey, paymentId);
    if (latestMismatch) throw new PollReviewStateError(id, latestMismatch);
    // Neither GetState nor this action charges/captures a payment. Only already durable capture qualifies.
    const linkage = await checkDurableLinkage(services, latestSession).catch(() => {
      throw new PollReviewStateError(id, "durable payment/order linkage is unavailable");
    });
    if (!linkage.paymentCaptured || !linkage.orderLinked || !linkage.orderId) {
      throw new PollReviewStateError(id, "payment is not captured and linked to an existing order");
    }
    if (services.query) {
      let orders: { readonly data: readonly Record<string, unknown>[] };
      try {
        orders = await services.query.graph({ entity: "order", fields: ["id"], filters: { id: linkage.orderId } });
      } catch {
        throw new PollReviewStateError(id, "order existence could not be verified");
      }
      if (!orders.data.some((order) => order["id"] === linkage.orderId)) {
        throw new PollReviewStateError(id, "linked order does not exist");
      }
    }
    const rows = await store.resolvePaymentAttemptManualReview({
      id, now: new Date(), operatorId: action.operatorId, reason: action.reason,
      expectedReviewAt: action.expectedReviewAt,
    });
    if (rows.length === 0) throw new PollReviewStateError(id);
  });
}
