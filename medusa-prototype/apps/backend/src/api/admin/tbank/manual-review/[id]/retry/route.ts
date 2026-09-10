import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { PaymentReconcilerService } from "../../../../../../modules/tbank/services/payment-reconciler";

export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const { id } = req.params;
  const body = (req.body ?? {}) as { reason?: string; operatorId?: string };
  const operatorId =
    body.operatorId ??
    (req as any).auth_context?.actor_id ??
    "admin_operator";

  try {
    const reconciler = new PaymentReconcilerService({ container: req.scope as any });
    await reconciler.retryManualReview(id, {
      operatorId,
      reason: body.reason,
    });
    res.json({ success: true, id, state: "pending" });
  } catch (err) {
    req.scope.resolve("logger").error(
      `Failed to reset manual review row ${id} to pending: ${err instanceof Error ? err.message : String(err)}`,
    );
    res.status(500).json({ message: "Failed to reset notification to pending" });
  }
}
