import { model } from "@medusajs/framework/utils";

const TbankFiscalReceipt = model
  .define(
    { name: "TbankFiscalReceipt", tableName: "tbank_fiscal_receipt" },
    {
      id: model.id({ prefix: "tbfiscal" }).primaryKey(),
      terminal_key: model.text(),
      payment_id: model.text(),
      order_id: model.text(),
      receipt_key: model.text(),
      receipt_type: model.text(),
      amount_kopecks: model.number(),
      success: model.boolean(),
      error_code: model.text(),
      fn_number: model.text().nullable(),
      fiscal_document_number: model.text().nullable(),
      fiscal_document_attribute: model.text().nullable(),
      receipt_datetime: model.text().nullable(),
      fiscal_number: model.text().nullable(),
      shift_number: model.text().nullable(),
      ecr_reg_number: model.text().nullable(),
      canonical_payload_hash: model.text(),
      lifecycle_state: model.enum(["awaiting_correlation", "processed", "manual_review"]).default("awaiting_correlation"),
      operation_id: model.text().nullable(),
      correlation_kind: model.enum(["prepayment", "refund", "closing"]).nullable(),
      processed_at: model.dateTime().nullable(),
    },
  )
  .indexes([
    { on: ["receipt_key"], unique: true, where: "deleted_at IS NULL" },
    { on: ["terminal_key", "payment_id", "lifecycle_state"] },
    { on: ["operation_id"] },
  ]);

export default TbankFiscalReceipt;
