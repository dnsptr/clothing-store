import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { z } from "@medusajs/framework/zod";
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils";
import { listShippingOptionsForCartWorkflow } from "@medusajs/medusa/core-flows";
import { objectRecord, selectCheckoutHandoff } from "../../../../lib/carrier-handoff";
import {
  YANDEX_DELIVERY_PROVIDER_CONFIG_ID,
  YANDEX_DELIVERY_PROVIDER_IDENTIFIER,
  YANDEX_OPTION_PVZ,
} from "../../../../modules/yandex-delivery/provider-id";
import { buildPricingParams, YandexFulfillmentDataError } from "../../../../modules/yandex-delivery/fulfillment-data";

import {
  getPublicYandexProvider,
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
  let provider;
  try {
    provider = getPublicYandexProvider();
  } catch {
    return res.status(503).json({ message: "Delivery service unavailable" });
  }
  if (provider === null) return res.status(503).json({ message: "Delivery service unavailable" });
  const { client, pvzPriceRub } = provider;
  try {
    const body = bodyResult.data;
    const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);
    const { data: carts } = await query.graph({
      entity: "cart",
      fields: [
        "id", "items.id", "items.variant_id", "items.quantity", "items.unit_price",
        "items.variant.id", "items.variant.weight", "items.variant.length", "items.variant.width", "items.variant.height",
        "items.variant.product.weight", "items.variant.product.length",
        "items.variant.product.width", "items.variant.product.height",
        "items.product.weight", "items.product.length", "items.product.width", "items.product.height",
        "shipping_methods.shipping_option_id", "shipping_methods.data",
      ],
      filters: { id: body.cart_id },
    });
    if (!carts[0]) return res.status(400).json({ message: "Invalid cart" });
    const { result: nativeOptions } = await listShippingOptionsForCartWorkflow(req.scope).run({
      input: { cart_id: body.cart_id },
    });
    const providerId = `${YANDEX_DELIVERY_PROVIDER_IDENTIFIER}_${YANDEX_DELIVERY_PROVIDER_CONFIG_ID}`;
    const options = nativeOptions.map(objectRecord).filter((option) =>
      option.provider_id === providerId &&
      objectRecord(option.data).id === YANDEX_OPTION_PVZ &&
      objectRecord(option.provider).is_enabled !== false &&
      option.insufficient_inventory !== true);
    const methods: unknown[] = Array.isArray(carts[0].shipping_methods) ? carts[0].shipping_methods : [];
    const savedMethod = methods.map(objectRecord).find((method) =>
      objectRecord(method.data).delivery_mode === YANDEX_OPTION_PVZ ||
      objectRecord(objectRecord(method.data).handoff_origin).carrier === "yandex" ||
      options.some((option) => option.id === method.shipping_option_id));
    const option = savedMethod
      ? options.find((candidate) => candidate.id === savedMethod.shipping_option_id)
      : options.length === 1 ? options[0] : undefined;
    if (!option) return res.status(400).json({ message: "Delivery source unavailable" });
    const location = objectRecord(objectRecord(option.service_zone).fulfillment_set).location;
    const origin = selectCheckoutHandoff(location, "yandex", savedMethod ? objectRecord(savedMethod.data) : undefined);
    const params = buildPricingParams(body.platform_station_id, carts[0].items, origin.id);
    const points = await client.getPickupPoints({ geo_id: body.geo_id });
    if (!points.some((point) => point.id === body.platform_station_id &&
      point.operatorId === "market_l4g")) {
      return res.status(400).json({ message: "Invalid pickup point" });
    }
    const key = `calc:${body.geo_id}:${JSON.stringify(params)}`;
    const result = await publicYandexGuard.run<YandexPricingResult>({
      key,
      cacheTtlMs: 30_000,
      execute: () => client.calculatePricing(params),
    });
    return res.json({
      ...(result.deliveryDays === undefined ? {} : { delivery_days: result.deliveryDays }),
      currency: result.currency,
      customer_cost: pvzPriceRub,
    });
  } catch (error) {
    if (error instanceof YandexFulfillmentDataError) {
      return res.status(400).json({ message: "Invalid cart measurements" });
    }
    if (error instanceof MedusaError && error.type === MedusaError.Types.INVALID_DATA) {
      return res.status(400).json({ message: "Delivery source unavailable" });
    }
    if (error instanceof PublicYandexGuardError) {
      const status = error.reason === "rate_limited" ? 429 : 503;
      const message = error.reason === "rate_limited" ? "Too many requests" : "Delivery service busy";
      return res.status(status).json({ message });
    }
    return res.status(502).json({ message: "Delivery provider unavailable" });
  }
}
