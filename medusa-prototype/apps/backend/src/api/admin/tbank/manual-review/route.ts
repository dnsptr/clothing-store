import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { z } from "@medusajs/framework/zod";
import { TBANK_NOTIFICATION_MODULE } from "../../../../modules/tbank-notifications";
import { notificationDto, paymentAttemptDto } from "./dto";
import { ManualReviewListQuerySchema, type ManualReviewListQuery } from "./validators";

type ManualReviewStore = {
  listAndCountTbankNotifications(
    filters: Record<string, unknown>,
    config: { readonly skip: number; readonly take: number; readonly order: Record<string, "ASC" | "DESC"> },
  ): Promise<[readonly Record<string, unknown>[], number]>;
  listAndCountTbankPaymentAttempts(
    filters: Record<string, unknown>,
    config: { readonly skip: number; readonly take: number; readonly order: Record<string, "ASC" | "DESC"> },
  ): Promise<[readonly Record<string, unknown>[], number]>;
};

export async function GET(
  req: MedusaRequest<unknown, ManualReviewListQuery>,
  res: MedusaResponse,
): Promise<void> {
  const notificationService = req.scope.resolve<ManualReviewStore>(TBANK_NOTIFICATION_MODULE);

  let query: ManualReviewListQuery;
  try {
    query = (req.validatedQuery as ManualReviewListQuery) ?? ManualReviewListQuerySchema.parse(req.query);
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ message: "Invalid query parameters", errors: err.issues });
      return;
    }
    throw err;
  }

  try {
    const [[notifications, count], [attempts, attemptCount]] = await Promise.all([
      notificationService.listAndCountTbankNotifications(
        { lifecycle_state: "manual_review" },
        { skip: query.offset, take: query.limit, order: { manual_review_at: "DESC" } },
      ),
      notificationService.listAndCountTbankPaymentAttempts(
        { poll_state: "manual_review" },
        { skip: query.offset, take: query.limit, order: { poll_manual_review_at: "DESC" } },
      ),
    ]);
    res.json({
      notifications: notifications.map(notificationDto),
      attempts: attempts.map(paymentAttemptDto),
      count,
      attempt_count: attemptCount,
      offset: query.offset,
      limit: query.limit,
    });
  } catch (err) {
    req.scope.resolve("logger").error(
      `Failed to list manual review notifications: ${err instanceof Error ? err.message : String(err)}`,
    );
    res.status(500).json({ message: "Failed to list manual review notifications" });
  }
}
