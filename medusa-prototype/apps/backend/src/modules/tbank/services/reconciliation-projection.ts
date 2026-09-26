import { processPaymentWorkflow } from "@medusajs/core-flows";
import type { PaymentActions, PaymentSessionDTO } from "@medusajs/types";

import { kopecksToRubles } from "../lib/money";
import type { NotificationRow, ReconciliationServices } from "./reconciliation-contracts";

export type ProjectionResult =
  | { readonly success: true }
  | { readonly success: false; readonly error: string };

export async function projectConfirmedPayment(
  services: ReconciliationServices,
  row: NotificationRow,
  session: PaymentSessionDTO,
): Promise<ProjectionResult> {
  const deterministicKey = `tbank_proj_${row.payment_id}`;
  const input = {
    action: "captured" as PaymentActions,
    data: { session_id: row.order_id, amount: kopecksToRubles(row.amount_kopecks) },
  };
  try {
    if (services.workflow) {
      const result = await services.workflow(input, {
        transactionId: deterministicKey,
        idempotencyKey: deterministicKey,
      });
      const firstError = result.errors?.[0];
      return firstError === undefined
        ? { success: true }
        : { success: false, error: firstError instanceof Error ? firstError.message : JSON.stringify(firstError) };
    }
    if (services.container) {
      const result = await processPaymentWorkflow(services.container).run({
        input,
        context: { transactionId: deterministicKey, idempotencyKey: deterministicKey },
        throwOnError: false,
      });
      const firstError = result.errors?.[0];
      return firstError === undefined
        ? { success: true }
        : { success: false, error: firstError instanceof Error ? firstError.message : JSON.stringify(firstError) };
    }
    await services.payment.updatePaymentSession({
      id: session.id,
      data: { ...(session.data ?? {}), status: "CONFIRMED" },
      currency_code: session.currency_code,
      amount: session.amount,
      status: "captured",
    });
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}
