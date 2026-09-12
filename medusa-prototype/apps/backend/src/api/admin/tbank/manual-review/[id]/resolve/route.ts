import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { PaymentReconcilerService } from "../../../../../../modules/tbank/services/payment-reconciler";
import {
  ManualReviewNotFoundError,
  ManualReviewStateError,
} from "../../../../../../modules/tbank/services/manual-review-operations";
import type { ManualReviewActionInput } from "../../validators";

type AuthenticatedAdminRequest = MedusaRequest<ManualReviewActionInput> & {
  readonly auth_context?: { readonly actor_id?: string };
};

export async function POST(
  req: AuthenticatedAdminRequest,
  res: MedusaResponse,
): Promise<void> {
  const { id } = req.params;
  const body = req.validatedBody;
  const operatorId = req.auth_context?.actor_id;
  if (!operatorId) {
    res.status(401).json({ message: "Authenticated admin actor is required" });
    return;
  }

  try {
    const reconciler = new PaymentReconcilerService({ container: req.scope });
    await reconciler.resolveManualReview(id, {
      operatorId,
      reason: body.reason,
    });
    res.json({ success: true, id, state: "processed", resolved: true });
  } catch (err) {
    if (err instanceof ManualReviewNotFoundError) {
      res.status(404).json({ message: err.message });
      return;
    }
    if (err instanceof ManualReviewStateError) {
      res.status(409).json({ message: err.message });
      return;
    }
    req.scope.resolve("logger").error(
      `Failed to resolve manual review row ${id}: ${err instanceof Error ? err.message : String(err)}`,
    );
    res.status(500).json({ message: "Failed to resolve notification" });
  }
}
