import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";

import { PaymentReconcilerService } from "../../../../../../modules/tbank/services/payment-reconciler";
import {
  PollReviewNotFoundError,
  PollReviewStateError,
} from "../../../../../../modules/tbank/services/poll-manual-review-operations";
import { NotificationIdSchema } from "../../../manual-review/validators";
import { pollReviewDetailsDto } from "../dto";

export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const parsed = NotificationIdSchema.safeParse(req.params.id);
  if (!parsed.success) {
    res.status(404).json({ message: "Invalid payment attempt ID format" });
    return;
  }
  try {
    const reconciler = new PaymentReconcilerService({ container: req.scope });
    const details = await reconciler.inspectPollReview(parsed.data);
    res.json({ details: pollReviewDetailsDto(details) });
  } catch (error) {
    if (error instanceof PollReviewNotFoundError) {
      res.status(404).json({ message: error.message });
    } else if (error instanceof PollReviewStateError) {
      res.status(409).json({ message: error.message });
    } else {
      req.scope.resolve("logger").error(`Failed to inspect payment attempt ${parsed.data}: ${String(error)}`);
      res.status(500).json({ message: "Failed to inspect payment attempt" });
    }
  }
}
