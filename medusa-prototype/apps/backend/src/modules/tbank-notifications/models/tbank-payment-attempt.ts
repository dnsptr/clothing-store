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
      notifications: model.hasMany(() => TbankNotification, { mappedBy: "payment_attempt" }),
    },
  )
  .indexes([
    { on: ["payment_session_id"], unique: true },
    { on: ["order_id"], unique: true },
  ]);

export default TbankPaymentAttempt;
