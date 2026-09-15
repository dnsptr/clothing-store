const DEFAULT_POLL_INTERVAL_MS = 2000;
const DEFAULT_MAX_POLL_ATTEMPTS = 15;

export type PaymentPollConfig = {
  readonly intervalMs: number;
  readonly maxAttempts: number;
};

function positiveNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function getPaymentPollConfig(): PaymentPollConfig {
  return {
    intervalMs: positiveNumber(
      process.env.NEXT_PUBLIC_PAYMENT_POLL_INTERVAL_MS,
      DEFAULT_POLL_INTERVAL_MS,
    ),
    maxAttempts: positiveNumber(
      process.env.NEXT_PUBLIC_PAYMENT_POLL_MAX_ATTEMPTS,
      DEFAULT_MAX_POLL_ATTEMPTS,
    ),
  };
}
