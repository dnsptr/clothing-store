import type { MedusaNextFunction, MedusaRequest, MedusaResponse } from "@medusajs/framework/http";

// Medusa accepts payment sessions for pp_system_default even when that provider
// is not linked to the cart's region. The provider completes orders without
// charging; a 100%-prepaid storefront must reject it at the write boundary.
export function requirePaidPaymentProvider(
  req: MedusaRequest,
  res: MedusaResponse,
  next: MedusaNextFunction,
): void {
  const body = req.body as { provider_id?: unknown } | undefined;
  if (body?.provider_id === "pp_system_default") {
    res.status(400).json({ message: "Бесплатный системный провайдер недоступен для оформления заказа" });
    return;
  }
  next();
}
