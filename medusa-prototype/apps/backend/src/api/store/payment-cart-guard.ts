import { isDeepStrictEqual } from "node:util";
import type { MedusaNextFunction, MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { MedusaError } from "@medusajs/framework/utils";
import { CHECKOUT_HOLD_MODULE } from "../../modules/checkout-holds/contracts";
import type CheckoutHoldModuleService from "../../modules/checkout-holds/service";
import { TBANK_PAYMENT_PROVIDER_ID } from "../../modules/tbank/provider-id";
import type { ReceiptQuery } from "../../modules/tbank/lib/receipt-source";

const FINISHED_SESSIONS: Readonly<Record<string, true>> = { error: true, canceled: true };

type LockedCart = Record<string, unknown> & {
  shipping_methods?: Array<{ shipping_option_id: string; data?: Record<string, unknown> }>;
  payment_collection?: { payment_sessions?: Array<{ provider_id: string; status: string }> };
};

/** Check supplied values; native nested-object replacement must not erase omitted fields. */
function unchanged(proposed: unknown, saved: unknown): boolean {
  if (proposed && typeof proposed === "object" && !Array.isArray(proposed)) {
    if (!saved || typeof saved !== "object" || Array.isArray(saved)) return false;
    for (const key in proposed) {
      if (Object.hasOwn(proposed, key) && (!Object.hasOwn(saved, key) ||
          !unchanged((proposed as Record<string, unknown>)[key], (saved as Record<string, unknown>)[key]))) return false;
    }
    return true;
  }
  return isDeepStrictEqual(proposed, saved);
}

/** Preserve the bank's goods/recipient/delivery contract, even if the total stays the same. */
export async function requireUnchangedPaymentCart(req: MedusaRequest, _res: MedusaResponse, next: MedusaNextFunction): Promise<void> {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return next();
  const match = /^\/store\/carts\/([^/]+)(.*)$/.exec(new URL(req.originalUrl, "http://store.local").pathname);
  if (!match || match[2] === "/complete") return next();
  const cartId = match[1];
  const query = req.scope.resolve<ReceiptQuery>("query");
  const { data } = await query.graph<LockedCart>({
    entity: "cart", filters: { id: cartId }, fields: [
      "*", "shipping_address.*", "billing_address.*", "shipping_methods.shipping_option_id", "shipping_methods.data",
      "payment_collection.payment_sessions.provider_id", "payment_collection.payment_sessions.status",
    ],
  });
  const cart = data[0];
  const sessions = cart?.payment_collection?.payment_sessions ?? [];
  const activePayment = sessions.some(session => session.provider_id === TBANK_PAYMENT_PROVIDER_ID && FINISHED_SESSIONS[session.status] !== true);
  const holds = req.scope.resolve<CheckoutHoldModuleService>(CHECKOUT_HOLD_MODULE);
  if (!activePayment && !(await holds.listOpenCartHolds(cartId, new Date())).length) return next();
  const body = req.body as Record<string, unknown> | undefined;
  if (req.method === "POST" && !match[2] && body && unchanged(body, cart)) {
    // Medusa replaces inline addresses: an unchanged subset would otherwise
    // clear the recipient/phone. An idempotent replay has no fields to update.
    req.body = {};
    if (req.validatedBody) req.validatedBody = {};
    return next();
  }
  if (req.method === "POST" && match[2] === "/shipping-methods" && body &&
      Object.keys(body).every(key => key === "option_id" || key === "data") &&
      cart?.shipping_methods?.length === 1 && cart.shipping_methods[0].shipping_option_id === body.option_id &&
      (body.data === undefined || unchanged(body.data, cart.shipping_methods[0].data ?? {}))) {
    const replay = { option_id: body.option_id, data: cart.shipping_methods[0].data ?? {} };
    req.body = replay;
    if (req.validatedBody) req.validatedBody = replay;
    return next();
  }
  throw new MedusaError(MedusaError.Types.CONFLICT, "Оплата уже начата: состав, получатель и доставка зафиксированы до завершения банковской сверки");
}
