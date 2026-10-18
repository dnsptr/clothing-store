import { model } from "@medusajs/framework/utils";

import TbankNotification from "./tbank-notification";

const TbankPaymentAttempt = model
  .define(
    { name: "TbankPaymentAttempt", tableName: "tbank_payment_attempt" },
    {
      id: model.id({ prefix: "tbatt" }).primaryKey(),
      payment_session_id: model.text(),
      provider_id: model.text(),
      terminal_key: model.text(),
      order_id: model.text(),
      expected_amount_kopecks: model.number(),
      currency_code: model.text(),
      poll_state: model.enum(["pending", "leased", "completed", "manual_review"]).default("pending"),
      poll_count: model.number().default(0),
      poll_next_at: model.dateTime().nullable(),
      poll_lease_token: model.text().nullable(),
      poll_lease_expires_at: model.dateTime().nullable(),
      poll_checked_at: model.dateTime().nullable(),
      poll_payment_id: model.text().nullable(),
      poll_bank_status: model.text().nullable(),
      poll_confirmed_at: model.dateTime().nullable(),
      poll_error: model.text().nullable(),
      poll_completed_at: model.dateTime().nullable(),
      poll_manual_review_at: model.dateTime().nullable(),
      notifications: model.hasMany(() => TbankNotification, { mappedBy: "payment_attempt" }),
    },
  )
  .indexes([
    { on: ["payment_session_id"], unique: true },
    { on: ["order_id"], unique: true },
    { on: ["poll_state", "poll_next_at", "poll_lease_expires_at"] },
  ]);

export default TbankPaymentAttempt;
