import { model } from "@medusajs/framework/utils";

import TbankNotification from "./tbank-notification";
import TbankPaymentAttemptAction from "./tbank-payment-attempt-action";

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
      poll_state: model.enum(["pending", "leased", "complete", "manual_review"]).default("pending"),
      poll_next_at: model.dateTime().nullable(),
      poll_lease_token: model.text().nullable(),
      poll_lease_expires_at: model.dateTime().nullable(),
      poll_consecutive_errors: model.number().default(0),
      poll_manual_review_at: model.dateTime().nullable(),
      poll_retry_until: model.dateTime().nullable(),
      poll_alert_sent_at: model.dateTime().nullable(),
      poll_alert_lease_token: model.text().nullable(),
      poll_alert_lease_expires_at: model.dateTime().nullable(),
      notifications: model.hasMany(() => TbankNotification, { mappedBy: "payment_attempt" }),
      actions: model.hasMany(() => TbankPaymentAttemptAction, { mappedBy: "payment_attempt" }),
    },
  )
  .indexes([
    { on: ["payment_session_id"], unique: true },
    { on: ["order_id"], unique: true },
    { on: ["terminal_key", "poll_state", "poll_next_at"] },
  ]);

export default TbankPaymentAttempt;
