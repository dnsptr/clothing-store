import { model } from "@medusajs/framework/utils";

const CheckoutHold = model.define("checkout_hold", {
  id: model.id({ prefix: "chold" }).primaryKey(),
  payment_session_id: model.text().unique(),
  cart_id: model.text(),
  allocations: model.json(),
  state: model.enum(["active", "settling", "consumed", "released", "expired"]).default("active"),
  expires_at: model.dateTime(),
}).indexes([{ on: ["state", "expires_at"] }, { on: ["cart_id"] }]);

export default CheckoutHold;
