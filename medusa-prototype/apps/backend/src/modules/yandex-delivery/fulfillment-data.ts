import { z } from "zod";

import type { YandexPickupPoint, YandexOfferCreateParams, YandexPricingParams } from "./lib/yandex-client";
import { YANDEX_OPTION_PVZ } from "./provider-id";

const text = z.string().trim().min(1).max(500);

const pvzSelectionSchema = z.object({
  delivery_mode: z.literal(YANDEX_OPTION_PVZ).optional(),
  platform_station_id: text,
  pvz_name: text,
  pvz_address: text,
  city: z.string().trim().min(1).max(100),
  geo_id: z.number().int().positive(),
  comment: text.optional(),
});

const packageSchema = z.object({
  weightGrossGrams: z.number().int().positive().max(100_000),
  dxCm: z.number().int().positive().max(300),
  dyCm: z.number().int().positive().max(300),
  dzCm: z.number().int().positive().max(300),
  assessedPriceRub: z.number().finite().positive().max(100_000_000),
});
const physicalSourceSchema = z.object({
  weight: z.unknown().optional(),
  length: z.unknown().optional(),
  width: z.unknown().optional(),
  height: z.unknown().optional(),
}).passthrough();
const measuredItemSchema = z.object({
  id: text,
  quantity: z.number().int().positive().max(1_000),
  unit_price: z.coerce.number().finite().nonnegative(),
  variant: physicalSourceSchema.extend({ product: physicalSourceSchema.nullish() }).nullish(),
  product: physicalSourceSchema.nullish(),
}).passthrough();
const dimensionsSchema = z.object({
  weight: z.number().finite().positive(),
  length: z.number().finite().positive(),
  width: z.number().finite().positive(),
  height: z.number().finite().positive(),
});
const shippingAddressSchema = z.object({
  first_name: z.string().trim().min(1).max(100),
  last_name: z.string().trim().min(1).max(100).optional(),
  phone: z.string().trim().regex(/^\+[1-9]\d{9,14}$/u),
  email: z.string().trim().email().optional(),
});
const orderSchema = z.object({
  id: text,
  display_id: z.union([text, z.number().int().nonnegative()]).optional(),
  shipping_address: shippingAddressSchema,
  items: z.array(measuredItemSchema.extend({ title: text })).min(1),
});
const fulfillmentItemsSchema = z.array(z.object({
  line_item_id: text,
  quantity: z.number().int().positive().max(1_000),
})).min(1).max(100);

export class YandexFulfillmentDataError extends Error {
  readonly name = "YandexFulfillmentDataError";

  constructor(readonly detail: string) {
    super(`Invalid Yandex fulfillment data: ${detail}`);
  }
}

function parse<T>(
  schema: { safeParse(value: unknown): { success: true; data: T } | { success: false } },
  value: unknown,
  detail: string,
): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new YandexFulfillmentDataError(detail);
  return result.data;
}

export function validatePvzSelection(data: Record<string, unknown>) {
  return parse(pvzSelectionSchema, data, "pvz selection");
}

export function confirmPvzSelection(data: Record<string, unknown>, points: readonly YandexPickupPoint[]) {
  const selection = validatePvzSelection(data);
  const point = points.find((candidate) => candidate.id === selection.platform_station_id);
  const same = (left: string, right: string) =>
    left.trim().replace(/\s+/gu, " ").toLocaleLowerCase("ru-RU") ===
    right.trim().replace(/\s+/gu, " ").toLocaleLowerCase("ru-RU");
  if (!point || point.operatorId !== "market_l4g" || !["pickup_point", "terminal"].includes(point.type) ||
    !same(selection.pvz_name, point.name) ||
    !same(selection.pvz_address, point.address.full_address) ||
    !same(selection.city, point.address.city) ||
    (point.address.geo_id !== undefined && selection.geo_id !== point.address.geo_id)) {
    throw new YandexFulfillmentDataError("unverified PVZ selection");
  }
  return {
    delivery_mode: YANDEX_OPTION_PVZ,
    platform_station_id: point.id,
    pvz_name: point.name,
    pvz_address: point.address.full_address,
    city: point.address.city,
    geo_id: selection.geo_id,
    ...(selection.comment ? { comment: selection.comment } : {}),
  };
}

export function buildCartPackage(items: unknown) {
  const parsedItems = parse(z.array(measuredItemSchema).min(1).max(100), items, "cart items");
  const measured = parsedItems.map((item) => {
    const physical = parse(dimensionsSchema, {
      weight: item.variant?.weight ?? item.variant?.product?.weight ?? item.product?.weight,
      length: item.variant?.length ?? item.variant?.product?.length ?? item.product?.length,
      width: item.variant?.width ?? item.variant?.product?.width ?? item.product?.width,
      height: item.variant?.height ?? item.variant?.product?.height ?? item.product?.height,
    }, "item physical attributes");
    return { ...physical, quantity: item.quantity, price: item.unit_price };
  });
  return parse(packageSchema, {
    weightGrossGrams: Math.ceil(measured.reduce((total, item) => total + item.weight * item.quantity, 0)),
    dxCm: Math.ceil(Math.max(...measured.map((item) => item.length))),
    dyCm: Math.ceil(Math.max(...measured.map((item) => item.width))),
    dzCm: Math.ceil(Math.max(...measured.map((item) => item.height))),
    assessedPriceRub: measured.reduce((total, item) => total + item.price * item.quantity, 0),
  }, "package");
}

export function buildPricingParams(stationId: string, items: unknown): YandexPricingParams {
  return { destinationStationId: stationId, ...buildCartPackage(items) };
}

export function buildOfferParams(
  data: Record<string, unknown>,
  items: unknown[],
  order: Record<string, unknown> | undefined,
): YandexOfferCreateParams {
  const selection = validatePvzSelection(data);
  if (data["delivery_mode"] !== YANDEX_OPTION_PVZ) throw new YandexFulfillmentDataError("delivery mode");
  const parsedOrder = parse(orderSchema, order, "order");
  const fulfillmentItems = parse(fulfillmentItemsSchema, items, "items");
  const usedIds = new Set<string>();
  const offerItems = fulfillmentItems.map((item) => {
    const orderItem = parsedOrder.items.find((candidate) => candidate.id === item.line_item_id);
    if (!orderItem || usedIds.has(item.line_item_id) || item.quantity > orderItem.quantity) {
      throw new YandexFulfillmentDataError("unmatched fulfillment items");
    }
    usedIds.add(item.line_item_id);
    const physical = parse(dimensionsSchema, {
      weight: orderItem.variant?.weight ?? orderItem.variant?.product?.weight ?? orderItem.product?.weight,
      length: orderItem.variant?.length ?? orderItem.variant?.product?.length ?? orderItem.product?.length,
      width: orderItem.variant?.width ?? orderItem.variant?.product?.width ?? orderItem.product?.width,
      height: orderItem.variant?.height ?? orderItem.variant?.product?.height ?? orderItem.product?.height,
    }, "item physical attributes");
    return {
      title: orderItem.title,
      unitPrice: orderItem.unit_price,
      article: orderItem.id,
      quantity: item.quantity,
      dxCm: Math.ceil(physical.length),
      dyCm: Math.ceil(physical.width),
      dzCm: Math.ceil(physical.height),
    };
  });
  const matchedOrderItems = fulfillmentItems.map((item) => ({
    ...parsedOrder.items.find((candidate) => candidate.id === item.line_item_id)!,
    quantity: item.quantity,
  }));
  const parcel = buildCartPackage(matchedOrderItems);
  const saved = parse(packageSchema, {
    weightGrossGrams: data["weight_gross_grams"],
    dxCm: data["dx_cm"],
    dyCm: data["dy_cm"],
    dzCm: data["dz_cm"],
    assessedPriceRub: data["assessed_price_rub"],
  }, "validated package");
  if (Object.keys(parcel).some((key) =>
    parcel[key as keyof typeof parcel] !== saved[key as keyof typeof saved])) {
    throw new YandexFulfillmentDataError("package changed since checkout");
  }
  const quote = z.number().finite().positive().safeParse(data["carrier_quote_amount"]);
  if (!quote.success || data["carrier_quote_currency"] !== "RUB") {
    throw new YandexFulfillmentDataError("verified quote");
  }
  return {
    orderId: String(parsedOrder.display_id ?? parsedOrder.id),
    destinationStationId: selection.platform_station_id,
    recipientFirstName: parsedOrder.shipping_address.first_name,
    recipientLastName: parsedOrder.shipping_address.last_name,
    recipientPhone: parsedOrder.shipping_address.phone,
    recipientEmail: parsedOrder.shipping_address.email,
    comment: selection.comment,
    items: offerItems,
    ...parcel,
  };
}

export function requireRequestId(fulfillment: Record<string, unknown>): string {
  const result = z.object({
    data: z.object({
      yandex_request_id: z.string().trim().min(1).max(200),
    }),
  }).safeParse(fulfillment);

  if (!result.success) throw new YandexFulfillmentDataError("request id");
  return result.data.data.yandex_request_id;
}
