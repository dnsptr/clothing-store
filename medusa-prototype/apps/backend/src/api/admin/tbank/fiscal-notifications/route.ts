import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { z } from "zod";

import { TBANK_NOTIFICATION_MODULE } from "../../../../modules/tbank-notifications";
import { ManualReviewListQuerySchema, type ManualReviewListQuery } from "../manual-review/validators";

type FiscalRow = Record<string, unknown>;
type FiscalStore = {
  listAndCountTbankFiscalNotifications(
    filters: { review_state: "manual_review" },
    config: { skip: number; take: number; order: { created_at: "DESC" } },
  ): Promise<[readonly FiscalRow[], number]>;
};

// The standard Medusa /admin/* authentication is applied by the framework.
export async function GET(
  req: MedusaRequest<unknown, ManualReviewListQuery>,
  res: MedusaResponse,
): Promise<void> {
  let query: ManualReviewListQuery;
  try {
    query = ManualReviewListQuerySchema.parse(req.validatedQuery ?? req.query);
  } catch (error) {
    if (!(error instanceof z.ZodError)) throw error;
    res.status(400).json({ message: "Invalid query parameters", errors: error.issues });
    return;
  }

  try {
    const store = req.scope.resolve<FiscalStore>(TBANK_NOTIFICATION_MODULE);
    const [rows, count] = await store.listAndCountTbankFiscalNotifications(
      { review_state: "manual_review" },
      { skip: query.offset, take: query.limit, order: { created_at: "DESC" } },
    );
    res.json({
      notifications: rows.map((row) => ({
        id: row.id,
        terminal_key: row.terminal_key,
        payment_id: row.payment_id,
        order_id: row.order_id,
        status: row.status,
        receipt_type: row.receipt_type,
        success: row.success,
        amount_kopecks: row.amount_kopecks,
        error_code: row.error_code,
        error_message: row.error_message,
        fn_number: row.fn_number,
        fiscal_document_number: row.fiscal_document_number,
        review_reason: row.review_reason,
        review_state: row.review_state,
        created_at: row.created_at,
      })),
      count,
      offset: query.offset,
      limit: query.limit,
    });
  } catch (error) {
    req.scope.resolve("logger").error(
      `Failed to list fiscal notifications: ${error instanceof Error ? error.message : String(error)}`,
    );
    res.status(500).json({ message: "Failed to list fiscal notifications" });
  }
}
