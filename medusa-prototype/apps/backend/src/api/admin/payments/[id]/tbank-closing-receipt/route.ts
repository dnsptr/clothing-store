import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { requestTbankClosingReceipt } from "../../../../../modules/tbank/services/refund-operations";
import type { TbankClosingReceiptInput } from "../tbank-refunds/validators";

export async function POST(req: AuthenticatedMedusaRequest<TbankClosingReceiptInput>, res: MedusaResponse): Promise<void> {
  res.setHeader("Cache-Control", "no-store");
  const operatorId = req.auth_context?.actor_id;
  if (!operatorId) {
    res.status(401).json({ message: "Authenticated admin actor is required" });
    return;
  }
  const body = req.validatedBody;
  const refund = await requestTbankClosingReceipt(req.scope, {
    payment_id: req.params.id,
    operator_id: operatorId,
    idempotency_key: body.idempotency_key,
    items: body.items,
  });
  const settled = refund.operation.state === "rejected" ||
    (refund.operation.state === "succeeded" && refund.operation.fiscal_state === "succeeded");
  res.status(settled ? 200 : 202).json({ refund });
}
