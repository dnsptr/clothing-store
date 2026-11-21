import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { getTbankRefundPreview, requestTbankRefund } from "../../../../../modules/tbank/services/refund-operations";
import type { TbankRefundInput } from "./validators";

export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse): Promise<void> {
  res.setHeader("Cache-Control", "no-store");
  if (!req.auth_context?.actor_id) {
    res.status(401).json({ message: "Authenticated admin actor is required" });
    return;
  }
  const refund = await getTbankRefundPreview(req.scope, req.params.id);
  res.json({ refund });
}

export async function POST(req: AuthenticatedMedusaRequest<TbankRefundInput>, res: MedusaResponse): Promise<void> {
  res.setHeader("Cache-Control", "no-store");
  const operatorId = req.auth_context?.actor_id;
  if (!operatorId) {
    res.status(401).json({ message: "Authenticated admin actor is required" });
    return;
  }
  const body = req.validatedBody;
  const refund = await requestTbankRefund(req.scope, {
    payment_id: req.params.id,
    operator_id: operatorId,
    idempotency_key: body.idempotency_key,
    items: body.items,
    receipt_mode: body.receipt_mode,
    ...(body.note ? { note: body.note } : {}),
  });
  const settled = refund.operation.state === "rejected" ||
    (refund.operation.state === "succeeded" && refund.operation.fiscal_state === "succeeded");
  res.status(settled ? 200 : 202).json({ refund });
}
