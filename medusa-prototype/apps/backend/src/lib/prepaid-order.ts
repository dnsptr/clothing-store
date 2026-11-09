import type { BigNumberInput } from "@medusajs/framework/types";
import { rublesToKopecks } from "../modules/tbank/lib/money";

export type PaymentEvidence = {
  captures?: ReadonlyArray<{ amount: unknown }>;
  refunds?: ReadonlyArray<{ amount: unknown }>;
};

/** A capture timestamp or authorization alone does not prove full net payment. */
export function isFullyCaptured(total: unknown, payments: readonly PaymentEvidence[] | undefined): boolean {
  try {
    const due = rublesToKopecks(total as BigNumberInput);
    if (due <= 0 || !payments?.length) return false;
    let captured = 0;
    let refunded = 0;
    for (const payment of payments) {
      for (const capture of payment.captures ?? []) {
        captured += rublesToKopecks(capture.amount as BigNumberInput);
      }
      for (const refund of payment.refunds ?? []) {
        refunded += rublesToKopecks(refund.amount as BigNumberInput);
      }
    }
    return Number.isSafeInteger(captured) && Number.isSafeInteger(refunded) && captured - refunded >= due;
  } catch {
    return false;
  }
}
