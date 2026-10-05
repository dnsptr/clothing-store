import { model } from "@medusajs/framework/utils";

import TbankPaymentAttempt from "./tbank-payment-attempt";

const TbankPaymentAttemptAction = model.define(
  { name: "TbankPaymentAttemptAction", tableName: "tbank_payment_attempt_action" },
  {
    id: model.id({ prefix: "tbact" }).primaryKey(),
    payment_attempt: model.belongsTo(() => TbankPaymentAttempt, { mappedBy: "actions" }),
    action: model.enum(["retry", "resolve"]),
    operator_id: model.text(),
    reason: model.text(),
  },
).indexes([{ on: ["payment_attempt_id", "created_at"] }]);

export default TbankPaymentAttemptAction;
