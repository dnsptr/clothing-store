import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { PaymentReconcilerService } from "../../../../../modules/tbank/services/payment-reconciler";
import {
  ManualReviewNotFoundError,
  ManualReviewStateError,
} from "../../../../../modules/tbank/services/manual-review-operations";
import { NotificationIdSchema } from "../validators";
import { manualReviewDetailsDto } from "../dto";

export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const idResult = NotificationIdSchema.safeParse(req.params.id);
  if (!idResult.success) {
    res.status(404).json({ message: "Invalid notification ID format" });
    return;
  }
  const id = idResult.data;
  try {
    const reconciler = new PaymentReconcilerService({ container: req.scope });
    const details = await reconciler.inspectManualReview(id);
    res.json({ details: manualReviewDetailsDto(details) });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (err instanceof ManualReviewNotFoundError) {
      res.status(404).json({ message });
      return;
    }
    if (err instanceof ManualReviewStateError) {
      res.status(409).json({ message });
      return;
    }
    req.scope.resolve("logger").error(`Failed to inspect manual review row ${id}: ${message}`);
    res.status(500).json({ message: "Failed to inspect manual review row" });
  }
}
