import type { AuthenticatedMedusaRequest, MedusaRequest, MedusaNextFunction, MedusaResponse } from "@medusajs/framework/http";
import { CHECKOUT_ACCESS_MODULE } from "../../modules/checkout-access";
import type CheckoutAccessModuleService from "../../modules/checkout-access/service";

interface AccessQuery {
  graph(input: { entity: string; fields: string[]; filters: Record<string, unknown> }): Promise<{ data: Record<string, unknown>[] }>;
}

interface CheckoutAccessRequest extends MedusaRequest {
  auth_context?: AuthenticatedMedusaRequest["auth_context"];
}

/** A publishable API key identifies the storefront, not the shopper. */
export async function requireCheckoutAccess(req: CheckoutAccessRequest, res: MedusaResponse, next: MedusaNextFunction): Promise<void> {
  res.setHeader("Cache-Control", "no-store");
  const path = new URL(req.originalUrl, "http://store.local").pathname;
  const query = req.scope.resolve<AccessQuery>("query");
  const access = req.scope.resolve<CheckoutAccessModuleService>(CHECKOUT_ACCESS_MODULE);
  let cartId: unknown;
  const cartPath = /^\/store\/carts\/([^/]+)(?:\/|$)/.exec(path);
  const statusPath = /^\/store\/payment-status\/([^/]+)$/.exec(path);
  const collectionPath = /^\/store\/payment-collections\/([^/]+)(?:\/|$)/.exec(path);
  const orderPath = /^\/store\/orders\/([^/]+)(?:\/|$)/.exec(path);
  if (cartPath) cartId = cartPath[1];
  else if (statusPath) cartId = statusPath[1];
  else if (collectionPath) {
    const { data } = await query.graph({ entity: "cart_payment_collection", fields: ["cart_id"], filters: { payment_collection_id: collectionPath[1] } });
    cartId = data[0]?.cart_id;
  } else if (orderPath) {
    const { data: orders } = await query.graph({ entity: "order", fields: ["id", "customer_id"], filters: { id: orderPath[1] } });
    const actor = req.auth_context;
    if (actor?.actor_type === "customer" && actor.actor_id && orders[0]?.customer_id === actor.actor_id) {
      next();
      return;
    }
    const { data } = await query.graph({ entity: "order_cart", fields: ["cart_id"], filters: { order_id: orderPath[1] } });
    cartId = data[0]?.cart_id;
  } else if (path === "/store/shipping-options") cartId = req.query.cart_id;
  else {
    const body: unknown = req.body;
    if (body && typeof body === "object" && "cart_id" in body) cartId = body.cart_id;
  }
  if (typeof cartId !== "string" || !/^cart_[0-9A-HJKMNP-TV-Z]{26}$/.test(cartId) ||
      !(await access.verifyCartToken(cartId, req.headers["x-cart-access-token"]))) {
    res.status(404).json({ message: "Checkout resource not found" });
    return;
  }
  next();
}

/** Address identifiers are not proof of ownership; Store API clients send address fields. */
export function requireInlineCartAddresses(req: MedusaRequest, res: MedusaResponse, next: MedusaNextFunction): void {
  const body: unknown = req.body;
  if (body && typeof body === "object" &&
      (("shipping_address" in body && typeof body.shipping_address === "string") ||
       ("billing_address" in body && typeof body.billing_address === "string"))) {
    res.status(400).json({ message: "Provide address fields instead of an address identifier" });
    return;
  }
  next();
}
