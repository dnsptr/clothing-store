import type {
  ManualReviewDetails,
  PaymentSessionService,
  TbankNotificationStore,
} from "./reconciliation-contracts";

export type OperatorAction = {
  readonly operatorId: string;
  readonly reason: string;
};

export class ManualReviewNotFoundError extends Error {
  readonly name = "ManualReviewNotFoundError";
  constructor(readonly notificationId: string) {
    super(`Notification ${notificationId} was not found`);
  }
}

export class ManualReviewStateError extends Error {
  readonly name = "ManualReviewStateError";
  constructor(readonly notificationId: string) {
    super(`Notification ${notificationId} is not in manual review`);
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
  let paymentSession = null;
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
