import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { z } from "zod";

import { TBANK_NOTIFICATION_MODULE } from "../../../../../modules/tbank-notifications";
import { ManualReviewListQuerySchema, type ManualReviewListQuery } from "../../manual-review/validators";
import { pollAttemptDto } from "./dto";

type PollReviewListStore = {
  listAndCountTbankPaymentAttempts(
    filters: Record<string, unknown>,
    config: { readonly skip: number; readonly take: number; readonly order: Record<string, "ASC" | "DESC"> },
  ): Promise<[readonly Record<string, unknown>[], number]>;
};

export async function GET(
  req: MedusaRequest<unknown, ManualReviewListQuery>,
  res: MedusaResponse,
): Promise<void> {
  let query: ManualReviewListQuery;
  try {
    query = (req.validatedQuery as ManualReviewListQuery) ?? ManualReviewListQuerySchema.parse(req.query);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ message: "Invalid query parameters", errors: error.issues });
      return;
    }
    throw error;
  }
  try {
    const store = req.scope.resolve<PollReviewListStore>(TBANK_NOTIFICATION_MODULE);
    const [attempts, count] = await store.listAndCountTbankPaymentAttempts(
      { poll_state: "manual_review" },
      { skip: query.offset, take: query.limit, order: { poll_manual_review_at: "DESC", id: "DESC" } },
    );
    res.json({ attempts: attempts.map(pollAttemptDto), count, offset: query.offset, limit: query.limit });
  } catch (error) {
    req.scope.resolve("logger").error(
      `Failed to list payment attempt manual review: ${error instanceof Error ? error.message : String(error)}`,
    );
    res.status(500).json({ message: "Failed to list payment attempts for manual review" });
  }
}
