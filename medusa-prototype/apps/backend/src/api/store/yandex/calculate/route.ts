import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { z } from "zod";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { buildPricingParams, YandexFulfillmentDataError } from "../../../../modules/yandex-delivery/fulfillment-data";

import {
  getPublicYandexClient,
  PublicYandexGuardError,
  publicYandexGuard,
} from "../../../../modules/yandex-delivery/public-api";
import type { YandexPricingResult } from "../../../../modules/yandex-delivery/lib/yandex-client";

const calculationSchema = z.object({
  cart_id: z.string().trim().regex(/^cart_[a-zA-Z0-9_]+$/u),
  platform_station_id: z.string().trim().min(1).max(200),
  geo_id: z.number().int().positive(),
}).strict();

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    publicYandexGuard.checkRate(req);
  } catch (error) {
    if (error instanceof PublicYandexGuardError && error.reason === "rate_limited") {
      return res.status(429).json({ message: "Too many requests" });
    }
    throw error;
  }
  const bodyResult = calculationSchema.safeParse(req.body);
  if (!bodyResult.success) return res.status(400).json({ message: "Invalid request" });
  let client;
  try {
    client = getPublicYandexClient();
  } catch {
    return res.status(503).json({ message: "Delivery service unavailable" });
  }
  if (client === null) return res.status(503).json({ message: "Delivery service unavailable" });
  try {
    const body = bodyResult.data;
    const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);
    const { data: carts } = await query.graph({
      entity: "cart",
      fields: [
        "id", "items.id", "items.quantity", "items.unit_price",
        "items.variant.weight", "items.variant.length", "items.variant.width", "items.variant.height",
        "items.variant.product.weight", "items.variant.product.length",
        "items.variant.product.width", "items.variant.product.height",
        "items.product.weight", "items.product.length", "items.product.width", "items.product.height",
      ],
      filters: { id: body.cart_id },
    });
    if (!carts[0]) return res.status(400).json({ message: "Invalid cart" });
    const points = await client.getPickupPoints({ geo_id: body.geo_id });
    if (!points.some((point) => point.id === body.platform_station_id &&
      point.operatorId === "market_l4g" &&
      (point.address.geo_id === undefined || point.address.geo_id === body.geo_id))) {
      return res.status(400).json({ message: "Invalid pickup point" });
    }
    const params = buildPricingParams(body.platform_station_id, carts[0].items);
    const key = `calc:${body.geo_id}:${JSON.stringify(params)}`;
    const result = await publicYandexGuard.run<YandexPricingResult>({
      key,
      cacheTtlMs: 30_000,
      execute: () => client.calculatePricing(params),
    });
    return res.json({
      price: result.priceRub,
      ...(result.deliveryDays === undefined ? {} : { delivery_days: result.deliveryDays }),
      currency: result.currency,
      customer_cost: 0,
    });
  } catch (error) {
    if (error instanceof YandexFulfillmentDataError) {
      return res.status(400).json({ message: "Invalid cart measurements" });
    }
    if (error instanceof PublicYandexGuardError) {
      const status = error.reason === "rate_limited" ? 429 : 503;
      const message = error.reason === "rate_limited" ? "Too many requests" : "Delivery service busy";
      return res.status(status).json({ message });
    }
    return res.status(502).json({ message: "Delivery provider unavailable" });
  }
}
