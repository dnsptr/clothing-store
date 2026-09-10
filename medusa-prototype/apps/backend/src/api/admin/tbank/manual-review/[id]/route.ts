import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { PaymentReconcilerService } from "../../../../../modules/tbank/services/payment-reconciler";

export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const { id } = req.params;
  try {
    const reconciler = new PaymentReconcilerService({ container: req.scope as any });
    const details = await reconciler.inspectManualReview(id);
    res.json({ details });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("not found")) {
      res.status(404).json({ message });
      return;
    }
    req.scope.resolve("logger").error(`Failed to inspect manual review row ${id}: ${message}`);
    res.status(500).json({ message: "Failed to inspect manual review row" });
  }
}
