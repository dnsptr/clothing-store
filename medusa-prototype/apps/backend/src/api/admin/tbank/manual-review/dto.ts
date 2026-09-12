import type { ManualReviewDetails } from "../../../../modules/tbank/services/reconciliation-contracts";

type Source = Readonly<Record<string, unknown>>;

export function notificationDto(row: Source) {
  return {
    id: row["id"],
    payment_id: row["payment_id"],
    status: row["status"],
    order_id: row["order_id"],
    amount_kopecks: row["amount_kopecks"],
    currency_code: row["currency_code"],
    success: row["success"],
    error_code: row["error_code"],
    message: row["message"],
    lifecycle_state: row["lifecycle_state"],
    attempt_count: row["attempt_count"],
    last_attempt_at: row["last_attempt_at"],
    last_error_at: row["last_error_at"],
    processed_at: row["processed_at"],
    manual_review_at: row["manual_review_at"],
    created_at: row["created_at"],
    updated_at: row["updated_at"],
  };
}

function paymentAttemptDto(row: Source | null) {
  if (!row) return null;
  return {
    id: row["id"],
    payment_session_id: row["payment_session_id"],
    provider_id: row["provider_id"],
    order_id: row["order_id"],
    expected_amount_kopecks: row["expected_amount_kopecks"],
    currency_code: row["currency_code"],
    created_at: row["created_at"],
    updated_at: row["updated_at"],
  };
}

function conflictDto(row: Source) {
  return {
    id: row["id"],
    canonical_notification_id: row["canonical_notification_id"],
    payment_id: row["payment_id"],
    status: row["status"],
    conflict_kind: row["conflict_kind"],
    correlation_failures: row["correlation_failures"],
    lifecycle_state: row["lifecycle_state"],
    created_at: row["created_at"],
    updated_at: row["updated_at"],
  };
}

export function manualReviewDetailsDto(details: ManualReviewDetails) {
  const session = details.paymentSession;
  return {
    notification: notificationDto(details.notification),
    paymentAttempt: paymentAttemptDto(details.paymentAttempt),
    conflicts: details.conflicts.map(conflictDto),
    paymentSession: session
      ? {
          id: session.id,
          status: session.status,
          currency_code: session.currency_code,
          amount: session.amount,
          provider_id: session.provider_id,
        }
      : null,
  };
}
