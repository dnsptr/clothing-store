import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { PaymentReconcilerService } from "../../../../../../modules/tbank/services/payment-reconciler";

export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const { id } = req.params;
  const body = (req.body ?? {}) as { reason?: string; operatorId?: string };

  if (!body.reason || typeof body.reason !== "string" || body.reason.trim().length === 0) {
    res.status(400).json({ message: "Reason is required for manual resolution" });
    return;
  }

  const operatorId =
    body.operatorId ??
    (req as any).auth_context?.actor_id ??
    "admin_operator";

  try {
    const reconciler = new PaymentReconcilerService({ container: req.scope as any });
    await reconciler.resolveManualReview(id, {
      operatorId,
      reason: body.reason.trim(),
    });
    res.json({ success: true, id, state: "processed", resolved: true });
  } catch (err) {
    req.scope.resolve("logger").error(
      `Failed to resolve manual review row ${id}: ${err instanceof Error ? err.message : String(err)}`,
    );
    res.status(500).json({ message: "Failed to resolve notification" });
  }
}
