import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";

import { PaymentReconcilerService } from "../../../../../../../modules/tbank/services/payment-reconciler";
import {
  PollReviewNotFoundError,
  PollReviewStateError,
} from "../../../../../../../modules/tbank/services/poll-manual-review-operations";
import { NotificationIdSchema } from "../../../../manual-review/validators";
import type { PollReviewActionInput } from "../../validators";

type AuthenticatedAdminRequest = MedusaRequest<PollReviewActionInput> & {
  readonly auth_context?: { readonly actor_id?: string };
};

export async function POST(req: AuthenticatedAdminRequest, res: MedusaResponse): Promise<void> {
  const parsed = NotificationIdSchema.safeParse(req.params.id);
  if (!parsed.success) {
    res.status(404).json({ message: "Invalid payment attempt ID format" });
    return;
  }
  const operatorId = req.auth_context?.actor_id;
  if (!operatorId) {
    res.status(401).json({ message: "Authenticated admin actor is required" });
    return;
  }
  try {
    const reconciler = new PaymentReconcilerService({ container: req.scope });
    await reconciler.resolvePollReview(parsed.data, {
      operatorId, reason: req.validatedBody.reason, expectedReviewAt: req.validatedBody.expectedReviewAt,
    });
    res.json({ success: true, id: parsed.data, state: "complete", resolved: true });
  } catch (error) {
    if (error instanceof PollReviewNotFoundError) {
      res.status(404).json({ message: error.message });
    } else if (error instanceof PollReviewStateError) {
      res.status(409).json({ message: error.message });
    } else {
      req.scope.resolve("logger").error(`Failed to resolve payment attempt ${parsed.data}: ${String(error)}`);
      res.status(500).json({ message: "Failed to resolve payment attempt" });
    }
  }
}
