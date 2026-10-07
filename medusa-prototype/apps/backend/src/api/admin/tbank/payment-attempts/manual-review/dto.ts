import type { PollManualReviewDetails } from "../../../../../modules/tbank/services/poll-manual-review-operations";

type Source = Readonly<Record<string, unknown>>;

export function pollAttemptDto(row: Source) {
  return {
    id: row["id"],
    payment_session_id: row["payment_session_id"],
    provider_id: row["provider_id"],
    order_id: row["order_id"],
    expected_amount_kopecks: row["expected_amount_kopecks"],
    currency_code: row["currency_code"],
    poll_state: row["poll_state"],
    poll_next_at: row["poll_next_at"],
    poll_consecutive_errors: row["poll_consecutive_errors"],
    poll_manual_review_at: row["poll_manual_review_at"],
    poll_retry_until: row["poll_retry_until"],
    poll_alert_sent_at: row["poll_alert_sent_at"],
    created_at: row["created_at"],
    updated_at: row["updated_at"],
  };
}

export function pollReviewDetailsDto(details: PollManualReviewDetails) {
  const session = details.paymentSession;
  return {
    paymentAttempt: pollAttemptDto(details.paymentAttempt),
    paymentSession: session ? {
      id: session.id,
      status: session.status,
      currency_code: session.currency_code,
      amount: session.amount,
      provider_id: session.provider_id,
    } : null,
    actions: details.actions.map(({ id, action, operator_id, reason, created_at }) => ({
      id, action, operator_id, reason, created_at,
    })),
  };
}
