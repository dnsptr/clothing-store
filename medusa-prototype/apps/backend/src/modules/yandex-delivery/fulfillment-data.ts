import { createHash } from "node:crypto";

import { z } from "@medusajs/framework/zod";

import type { YandexPickupPoint, YandexOfferCreateParams, YandexPricingParams, YandexPlace } from "./lib/yandex-client";
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

const placeDimensionsSchema = z.object({
  weightGrossGrams: z.number().int().positive().max(30_000),
  dxCm: z.number().int().positive().max(150),
  dyCm: z.number().int().positive().max(150),
  dzCm: z.number().int().positive().max(150),
}).refine((place) => place.dxCm + place.dyCm + place.dzCm <= 300);
const physicalSourceSchema = z.object({
  weight: z.unknown().optional(),
  length: z.unknown().optional(),
  width: z.unknown().optional(),
  height: z.unknown().optional(),
}).passthrough();
const measuredItemSchema = z.object({
  id: text,
  variant_id: text.nullish(),
  quantity: z.number().int().positive().max(100),
  unit_price: z.coerce.number().finite().nonnegative().max(100_000_000),
  variant: physicalSourceSchema.extend({ id: text.optional(), product: physicalSourceSchema.nullish() }).nullish(),
  product: physicalSourceSchema.nullish(),
}).passthrough();
const dimensionsSchema = z.object({
  weight: z.number().finite().positive(),
  length: z.number().finite().positive(),
  width: z.number().finite().positive(),
  height: z.number().finite().positive(),
});
const manifestGroupSchema = z.object({
  groupId: z.string().regex(/^[a-f0-9]{64}$/u),
  variantId: text,
  quantity: z.number().int().positive().max(100),
  unitPriceRub: z.number().finite().nonnegative().max(100_000_000),
  measurements: dimensionsSchema.strict(),
}).strict();
const manifestSchema = z.array(manifestGroupSchema).min(1).max(100);
type ManifestGroup = z.infer<typeof manifestGroupSchema>;
const shippingAddressSchema = z.object({
  first_name: z.string().trim().min(1).max(100),
  last_name: z.string().trim().min(1).max(100).optional(),
  phone: z.string().trim().regex(/^\+[1-9]\d{9,14}$/u),
});
const orderSchema = z.object({
  id: text,
  display_id: z.union([text, z.number().int().nonnegative()]).optional(),
  email: z.string().trim().email().optional(),
  shipping_address: shippingAddressSchema,
  items: z.array(measuredItemSchema.extend({ title: text })).min(1).max(100),
});
const fulfillmentItemsSchema = z.array(z.object({
  line_item_id: text,
  quantity: z.number().int().positive().max(100),
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
    !same(selection.city, point.address.city)) {
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

function groupIdentity(group: Pick<ManifestGroup, "variantId" | "unitPriceRub" | "measurements">) {
  const { weight, length, width, height } = group.measurements;
  return createHash("sha256")
    .update(JSON.stringify([group.variantId, group.unitPriceRub, weight, length, width, height]), "utf8")
    .digest("hex");
}

function expandManifest(manifest: ManifestGroup[]) {
  const places: YandexPlace[] = [];
  let assessedPriceRub = 0;
  let totalWeight = 0;
  for (const group of manifest) {
    if (places.length + group.quantity > 100) throw new YandexFulfillmentDataError("too many places");
    const dims = parse(placeDimensionsSchema, {
      weightGrossGrams: Math.ceil(group.measurements.weight),
      dxCm: Math.ceil(group.measurements.length),
      dyCm: Math.ceil(group.measurements.width),
      dzCm: Math.ceil(group.measurements.height),
    }, "place dimensions");
    totalWeight += dims.weightGrossGrams * group.quantity;
    assessedPriceRub += group.unitPriceRub * group.quantity;
    for (let unitIndex = 1; unitIndex <= group.quantity; unitIndex += 1) {
      places.push({ groupId: group.groupId, unitIndex, ...dims });
    }
  }
  if (totalWeight > 200_000) throw new YandexFulfillmentDataError("order weight exceeds PVZ limit");
  parse(z.number().finite().positive().max(100_000_000), assessedPriceRub, "assessed price");
  return { places, assessedPriceRub };
}

export function buildCartPackages(items: unknown) {
  const parsedItems = parse(z.array(measuredItemSchema).min(1).max(100), items, "cart items");
  const lineIds = new Map<string, true>();
  const groups = new Map<string, ManifestGroup>();
  let count = 0;
  for (const item of parsedItems) {
    if (lineIds.has(item.id)) throw new YandexFulfillmentDataError("duplicate line item id");
    lineIds.set(item.id, true);
    count += item.quantity;
    if (count > 100) throw new YandexFulfillmentDataError("too many places");
    const variantId = item.variant_id ?? item.variant?.id;
    if (!variantId || (item.variant_id && item.variant?.id && item.variant_id !== item.variant.id)) {
      throw new YandexFulfillmentDataError("item variant identity");
    }
    const measurements = parse(dimensionsSchema, {
      weight: item.variant?.weight ?? item.variant?.product?.weight ?? item.product?.weight,
      length: item.variant?.length ?? item.variant?.product?.length ?? item.product?.length,
      width: item.variant?.width ?? item.variant?.product?.width ?? item.product?.width,
      height: item.variant?.height ?? item.variant?.product?.height ?? item.product?.height,
    }, "item physical attributes");
    const group = { variantId, quantity: item.quantity, unitPriceRub: item.unit_price, measurements };
    const groupId = groupIdentity(group);
    const existing = groups.get(groupId);
    if (existing) existing.quantity += item.quantity;
    else groups.set(groupId, { groupId, ...group });
  }
  // Cart and order rows receive different IDs in Medusa. Equivalent units of
  // the same catalog variant form one stable group across that conversion.
  const manifest = [...groups.values()].sort((left, right) =>
    left.groupId < right.groupId ? -1 : left.groupId > right.groupId ? 1 : 0);
  return { manifest, ...expandManifest(manifest) };
}

export function buildPricingParams(stationId: string, items: unknown, sourceStationId: string): YandexPricingParams {
  const { places, assessedPriceRub } = buildCartPackages(items);
  return { sourceStationId, destinationStationId: stationId, places, assessedPriceRub };
}

export function buildOfferParams(
  data: Record<string, unknown>,
  items: unknown[],
  order: Record<string, unknown> | undefined,
  sourceStationId: string,
): YandexOfferCreateParams {
  const selection = validatePvzSelection(data);
  if (data["delivery_mode"] !== YANDEX_OPTION_PVZ) throw new YandexFulfillmentDataError("delivery mode");
  const parsedOrder = parse(orderSchema, order, "order");
  const fulfillmentItems = parse(fulfillmentItemsSchema, items, "items");
  const orderItemsById = new Map(parsedOrder.items.map((item) => [item.id, item]));
  if (orderItemsById.size !== parsedOrder.items.length || fulfillmentItems.length !== parsedOrder.items.length) {
    throw new YandexFulfillmentDataError("unmatched fulfillment items");
  }
  for (const item of fulfillmentItems) {
    const orderItem = orderItemsById.get(item.line_item_id);
    if (!orderItem || item.quantity !== orderItem.quantity) {
      throw new YandexFulfillmentDataError("unmatched fulfillment items");
    }
    orderItemsById.delete(item.line_item_id);
  }
  const parcel = buildCartPackages(parsedOrder.items);
  const saved = parse(manifestSchema, data["package_manifest"], "validated package manifest")
    .sort((left, right) => left.groupId < right.groupId ? -1 : left.groupId > right.groupId ? 1 : 0);
  // Include the unrounded measurements, prices and quantities in comparison:
  // equal dimensions or weights alone do not identify paid-for clothing units.
  if (saved.length !== parcel.manifest.length || saved.some((group, index) => {
    const current = parcel.manifest[index];
    return group.groupId !== current.groupId || group.variantId !== current.variantId ||
      group.quantity !== current.quantity || group.unitPriceRub !== current.unitPriceRub ||
      group.measurements.weight !== current.measurements.weight ||
      group.measurements.length !== current.measurements.length ||
      group.measurements.width !== current.measurements.width ||
      group.measurements.height !== current.measurements.height;
  })) {
    throw new YandexFulfillmentDataError("package manifest changed since checkout");
  }
  const titleByVariant = new Map<string, string>();
  for (const item of parsedOrder.items) {
    const variantId = item.variant_id ?? item.variant!.id!;
    const title = titleByVariant.get(variantId);
    if (title === undefined || item.title < title) titleByVariant.set(variantId, item.title);
  }
  const groupsById = new Map(parcel.manifest.map((group) => [group.groupId, group]));
  const offerItems = parcel.places.map((place) => {
    const group = groupsById.get(place.groupId)!;
    return {
      title: titleByVariant.get(group.variantId)!,
      unitPrice: group.unitPriceRub,
      article: group.variantId,
      groupId: place.groupId,
      unitIndex: place.unitIndex,
    };
  });
  const quote = z.number().finite().nonnegative().safeParse(data["carrier_quote_amount"]);
  if (!quote.success || data["carrier_quote_currency"] !== "RUB") {
    throw new YandexFulfillmentDataError("verified quote");
  }
  return {
    sourceStationId,
    orderId: String(parsedOrder.display_id ?? parsedOrder.id),
    destinationStationId: selection.platform_station_id,
    recipientFirstName: parsedOrder.shipping_address.first_name,
    recipientLastName: parsedOrder.shipping_address.last_name,
    recipientPhone: parsedOrder.shipping_address.phone,
    recipientEmail: parsedOrder.email,
    comment: selection.comment,
    items: offerItems,
    places: parcel.places,
    assessedPriceRub: parcel.assessedPriceRub,
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
