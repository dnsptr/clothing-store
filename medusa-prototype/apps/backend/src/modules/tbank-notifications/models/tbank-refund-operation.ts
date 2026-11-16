import { model } from "@medusajs/framework/utils";

const TbankRefundOperation = model.define(
  { name: "TbankRefundOperation", tableName: "tbank_refund_operation" },
  {
    id: model.id({ prefix: "tbref" }).primaryKey(),
    kind: model.enum(["prepayment", "refund", "closing"]),
    payment_id: model.text(),
    payment_session_id: model.text(),
    bank_payment_id: model.text(),
    terminal_key: model.text(),
    idempotency_key: model.text(),
    request_hash: model.text(),
    snapshot_hash: model.text(),
    external_request_id: model.text(),
    amount_kopecks: model.number(),
    original_amount_kopecks: model.number(),
    balance_before_kopecks: model.number(),
    selections: model.json(),
    credit_amount_kopecks: model.number(),
    receipt_mode: model.enum(["prepayment", "full_payment"]),
    state: model.enum(["prepared", "submitting", "succeeded", "rejected", "indeterminate"]).default("prepared"),
    fiscal_state: model.enum(["pending", "succeeded", "failed"]).default("pending"),
    fiscal_receipt_id: model.text().nullable(),
    fiscal_receipt_type: model.text().nullable(),
    native_refund_id: model.text().nullable(),
    error_code: model.text().nullable(),
    operator_id: model.text(),
    note: model.text().nullable(),
    refund_reason_id: model.text().nullable(),
    submitted_at: model.dateTime().nullable(),
  },
).indexes([
  { on: ["payment_id", "idempotency_key"], unique: true, where: "deleted_at IS NULL" },
  { on: ["terminal_key", "bank_payment_id", "state"] },
  { on: ["state", "updated_at"] },
]);

export default TbankRefundOperation;
