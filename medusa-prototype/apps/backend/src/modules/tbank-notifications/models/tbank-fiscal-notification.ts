import { model } from "@medusajs/framework/utils";

/** Sanitized, signed fiscalization callback; never stores a receipt or bank token. */
const TbankFiscalNotification = model
  .define(
    { name: "TbankFiscalNotification", tableName: "tbank_fiscal_notification" },
    {
      id: model.id({ prefix: "tbfiscal" }).primaryKey(),
      fingerprint: model.text(),
      terminal_key: model.text(),
      payment_id: model.text().nullable(),
      order_id: model.text().nullable(),
      status: model.text().nullable(),
      receipt_type: model.text().nullable(),
      success: model.boolean().nullable(),
      amount_kopecks: model.number().nullable(),
      error_code: model.text().nullable(),
      error_message: model.text().nullable(),
      fn_number: model.text().nullable(),
      fiscal_document_number: model.text().nullable(),
      review_reason: model.text().nullable(),
      review_state: model.enum(["observed", "manual_review"]).default("manual_review"),
    },
  )
  .indexes([
    { on: ["fingerprint"], unique: true, where: "deleted_at IS NULL" },
    { on: ["review_state", "created_at"] },
    { on: ["terminal_key", "payment_id"] },
  ]);

export default TbankFiscalNotification;
