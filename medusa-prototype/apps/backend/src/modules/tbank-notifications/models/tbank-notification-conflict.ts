import { model } from "@medusajs/framework/utils";

const TbankNotificationConflict = model
  .define(
    { name: "TbankNotificationConflict", tableName: "tbank_notification_conflict" },
    {
      id: model.id({ prefix: "tbconf" }).primaryKey(),
      canonical_notification_id: model.text().nullable(),
      terminal_key: model.text(),
      payment_id: model.text(),
      status: model.text(),
      canonical_payload_hash: model.text().nullable(),
      conflicting_payload_hash: model.text(),
      conflict_kind: model.text(),
      correlation_failures: model.text().nullable(),
      lifecycle_state: model.enum(["manual_review"]).default("manual_review"),
    },
  )
  .indexes([
    { on: ["payment_id", "status"] },
    { on: ["canonical_notification_id"] },
  ]);

export default TbankNotificationConflict;
