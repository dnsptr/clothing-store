import { model } from "@medusajs/framework/utils";

const CartAccess = model.define("cart_access", {
  id: model.id({ prefix: "cartacc" }).primaryKey(),
  cart_id: model.text(),
  token_digest: model.text(),
}).indexes([{ on: ["cart_id"], unique: true }]);

export default CartAccess;
