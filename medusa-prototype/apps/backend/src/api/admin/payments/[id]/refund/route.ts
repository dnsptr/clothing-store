import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import type { BigNumberInput, IPaymentModuleService } from "@medusajs/types";
import { MedusaError, Modules } from "@medusajs/framework/utils";
import { refundPaymentWorkflow } from "@medusajs/core-flows";
import { TBANK_PAYMENT_PROVIDER_ID } from "../../../../../modules/tbank/provider-id";
import { requestTbankAmountRefund } from "../../../../../modules/tbank/services/refund-operations";

type NativeRefundInput = { amount?: BigNumberInput; refund_reason_id?: string; note?: string; idempotency_key?: string };

export async function POST(req: AuthenticatedMedusaRequest<NativeRefundInput>, res: MedusaResponse): Promise<void> {
  res.setHeader("Cache-Control", "no-store");
  const operatorId = req.auth_context?.actor_id;
  if (!operatorId) { res.status(401).json({ message: "Authenticated admin actor is required" }); return; }
  const payments = req.scope.resolve<IPaymentModuleService>(Modules.PAYMENT);
  const payment = await payments.retrievePayment(req.params.id);
  const body = req.validatedBody;
  if (payment.provider_id === TBANK_PAYMENT_PROVIDER_ID) {
    const refund = await requestTbankAmountRefund(req.scope, {
      payment_id: payment.id, operator_id: operatorId,
      idempotency_key: body.idempotency_key ?? `native-full-${payment.id}`,
      ...(body.amount !== undefined ? { amount: body.amount } : {}),
      ...(body.note ? { note: body.note } : {}),
      ...(body.refund_reason_id ? { refund_reason_id: body.refund_reason_id } : {}),
    });
    if (refund.operation.state !== "succeeded" || !refund.operation.native_refund_id) {
      throw new MedusaError(refund.operation.state === "rejected" ? MedusaError.Types.NOT_ALLOWED : MedusaError.Types.CONFLICT,
        "Возврат ещё не подтверждён; состояние и прежний ключ сохранены в разделе чеков Т-Банка");
    }
  } else {
    await refundPaymentWorkflow(req.scope).run({ input: { ...body, payment_id: payment.id, created_by: operatorId } });
  }
  const updated = await payments.retrievePayment(payment.id, { relations: ["captures", "refunds", "payment_session"] });
  res.json({ payment: updated });
}
