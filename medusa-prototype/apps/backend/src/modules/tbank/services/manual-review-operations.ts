import type { PaymentSessionDTO } from "@medusajs/types";

import type {
  ManualReviewDetails,
  PaymentSessionService,
  TbankNotificationStore,
} from "./reconciliation-contracts";

export type OperatorAction = {
  readonly operatorId: string;
  readonly reason: string;
};

export type AttemptManualReviewDetails = {
  readonly attempt: Record<string, unknown>;
  readonly conflicts: readonly Record<string, unknown>[];
  readonly paymentSession: PaymentSessionDTO | null;
};

export class ManualReviewNotFoundError extends Error {
  readonly name = "ManualReviewNotFoundError";
  constructor(readonly notificationId: string) {
    super(`T-Bank review ${notificationId} was not found`);
  }
}

export class ManualReviewStateError extends Error {
  readonly name = "ManualReviewStateError";
  constructor(readonly notificationId: string) {
    super(`T-Bank review ${notificationId} is not in manual review`);
  }
}

function isNotFoundError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as Record<string, unknown>;
  if (e.type === "not_found" || e.code === "NOT_FOUND" || e.status === 404) return true;
  if (typeof e.message === "string" && e.message.toLowerCase().includes("not found")) return true;
  return false;
}

export async function inspectManualReview(
  notifications: TbankNotificationStore,
  payment: PaymentSessionService,
  id: string,
): Promise<ManualReviewDetails> {
  const found = await notifications.listTbankNotifications?.({ id }, { take: 1 });
  const notification = found?.[0];
  if (!notification) throw new ManualReviewNotFoundError(id);
  if (notification["lifecycle_state"] !== "manual_review") throw new ManualReviewStateError(id);
  const orderId = notification["order_id"];
  const paymentId = notification["payment_id"];
  const attempts = notifications.listTbankPaymentAttempts && typeof orderId === "string"
    ? await notifications.listTbankPaymentAttempts({ order_id: orderId }, { take: 1 })
    : [];
  const conflicts = notifications.listTbankNotificationConflicts && typeof paymentId === "string"
    ? await notifications.listTbankNotificationConflicts({ payment_id: paymentId }, { take: 100 })
    : [];
  let paymentSession: PaymentSessionDTO | null = null;
  if (typeof orderId === "string" && payment.retrievePaymentSession) {
    try {
      paymentSession = await payment.retrievePaymentSession(orderId);
    } catch (err) {
      if (isNotFoundError(err)) {
        paymentSession = null;
      } else {
        throw err;
      }
    }
  }
  return {
    notification,
    paymentAttempt: attempts[0] ?? null,
    conflicts,
    paymentSession,
  };
}

export async function inspectAttemptManualReview(
  notifications: TbankNotificationStore,
  payment: PaymentSessionService,
  id: string,
): Promise<AttemptManualReviewDetails> {
  if (!notifications.listTbankPaymentAttempts) throw new Error("Payment attempt review store is unavailable");
  const attempt = (await notifications.listTbankPaymentAttempts({ id }, { take: 1 }))[0];
  if (!attempt) throw new ManualReviewNotFoundError(id);
  if (attempt["poll_state"] !== "manual_review") throw new ManualReviewStateError(id);
  const paymentId = typeof attempt["poll_payment_id"] === "string"
    ? attempt["poll_payment_id"]
    : `attempt:${id}`;
  const conflicts = notifications.listTbankNotificationConflicts
    ? await notifications.listTbankNotificationConflicts({ payment_id: paymentId }, { take: 100 })
    : [];
  let paymentSession: PaymentSessionDTO | null = null;
  if (typeof attempt["payment_session_id"] === "string") {
    try {
      paymentSession = await payment.retrievePaymentSession(attempt["payment_session_id"]);
    } catch (error) {
      if (!isNotFoundError(error)) throw error;
    }
  }
  return { attempt, conflicts, paymentSession };
}

export async function transitionAttemptManualReview(
  notifications: TbankNotificationStore,
  id: string,
  action: OperatorAction,
  outcome: "pending" | "completed",
): Promise<void> {
  if (!notifications.listTbankPaymentAttempts || !notifications.transitionPollManualReview) {
    throw new Error("Payment attempt review store is unavailable");
  }
  const attempt = (await notifications.listTbankPaymentAttempts({ id }, { take: 1 }))[0];
  if (!attempt) throw new ManualReviewNotFoundError(id);
  if (attempt["poll_state"] !== "manual_review") throw new ManualReviewStateError(id);
  const rows = await notifications.transitionPollManualReview({ id, now: new Date(), ...action, outcome });
  if (rows.length === 0) throw new ManualReviewStateError(id);
}

export async function retryManualReview(
  notifications: TbankNotificationStore,
  id: string,
  action: OperatorAction,
): Promise<void> {
  if (notifications.listTbankNotifications) {
    const found = await notifications.listTbankNotifications({ id }, { take: 1 });
    const notification = found?.[0];
    if (!notification) throw new ManualReviewNotFoundError(id);
    if (notification["lifecycle_state"] !== "manual_review") throw new ManualReviewStateError(id);
  }
  const rows = await notifications.retryManualReview({ id, now: new Date(), ...action });
  if (rows.length === 0) throw new ManualReviewStateError(id);
}

export async function resolveManualReview(
  notifications: TbankNotificationStore,
  id: string,
  action: OperatorAction,
): Promise<void> {
  if (notifications.listTbankNotifications) {
    const found = await notifications.listTbankNotifications({ id }, { take: 1 });
    const notification = found?.[0];
    if (!notification) throw new ManualReviewNotFoundError(id);
    if (notification["lifecycle_state"] !== "manual_review") throw new ManualReviewStateError(id);
  }
  const rows = await notifications.resolveManualReview({ id, now: new Date(), ...action });
  if (rows.length === 0) throw new ManualReviewStateError(id);
}
