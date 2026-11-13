import { createHash } from "node:crypto";
import { BigNumber } from "@medusajs/framework/utils";
import { z } from "@medusajs/framework/zod";

import {
  CDEK_OPTION_COURIER,
  CDEK_OPTION_PICKUP,
  CDEK_OPTION_PVZ,
} from "./provider-id";
import { packageSchema } from "./lib/cdek-schemas";

export type PickupStoreLocation = {
  readonly id: string;
  readonly name: string;
  readonly address: string;
  readonly metro: string;
  readonly workHours: string;
  readonly phone: string;
};

export const MOSCOW_PICKUP_STORES: readonly PickupStoreLocation[] = [
  {
    id: "store_vodny",
    name: "ТЦ «Водный»",
    address: "г. Москва, Головинское шоссе, д. 5, корп. 1",
    metro: "м. Водный стадион",
    workHours: "10:00 — 22:00 ежедневно",
    phone: "+7 (926) 057-72-05",
  },
  {
    id: "store_govorovo",
    name: "ТЦ «Говорово»",
    address: "г. Москва, 47-й км МКАД, стр. 1",
    metro: "м. Говорово",
    workHours: "10:00 — 22:00 ежедневно",
    phone: "+7 (926) 057-72-05",
  },
  {
    id: "store_nebo",
    name: "ТЦ «Небо»",
    address: "г. Москва, ул. Авиаторов, д. 3А",
    metro: "м. Солнцево",
    workHours: "10:00 — 22:00 ежедневно",
    phone: "+7 (926) 057-72-05",
  },
] as const;

const cityCodeSchema = z.number().int().positive();
const requiredTextSchema = z.string().trim().min(1).max(500);

const pvzSelectionSchema = z.object({
  city_code: cityCodeSchema,
  cdek_pvz_code: requiredTextSchema,
});

const courierSelectionSchema = z.object({
  city_code: cityCodeSchema,
  delivery_address: requiredTextSchema,
});

const pickupSelectionSchema = z.object({
  pickup_store_id: requiredTextSchema,
});

const deliveryModeSchema = z.enum([
  CDEK_OPTION_PVZ,
  CDEK_OPTION_COURIER,
  CDEK_OPTION_PICKUP,
]);

export class CdekFulfillmentDataError extends Error {
  readonly name = "CdekFulfillmentDataError";

  constructor(readonly detail: string) {
    super(`Invalid CDEK fulfillment data: ${detail}`);
  }
}

export class UnsupportedCdekCancellationError extends Error {
  readonly name = "UnsupportedCdekCancellationError";

  constructor() {
    super("CDEK fulfillment cancellation is unsupported");
  }
}

export class UnsupportedCdekReturnError extends Error {
  readonly name = "UnsupportedCdekReturnError";

  constructor() {
    super("CDEK return fulfillment is unsupported");
  }
}

const physicalSourceSchema = z.object({
  weight: z.unknown().optional(),
  length: z.unknown().optional(),
  width: z.unknown().optional(),
  height: z.unknown().optional(),
}).passthrough();

const unitPriceSchema = z.preprocess(
  (value) => value instanceof BigNumber ? value.numeric :
    typeof value === "string" && /^-?\d+(?:\.\d+)?(?:e[+-]?\d+)?$/iu.test(value.trim()) ? Number(value) : value,
  z.number().finite().nonnegative().max(50_000_000),
);

const orderItemSchema = z.object({
  id: z.string().trim().min(1).max(200),
  unit_price: unitPriceSchema,
  variant_id: z.string().trim().min(1).max(200).nullish(),
  variant: physicalSourceSchema.extend({
    id: z.string().trim().min(1).max(200).optional(),
    product: physicalSourceSchema.nullish(),
  }).nullish(),
  product: physicalSourceSchema.nullish(),
  quantity: z.number().int().positive().max(100),
}).passthrough();

const orderItemsSchema = z.array(orderItemSchema).min(1).max(100).superRefine((items, context) => {
  const ids: Record<string, true> = Object.create(null);
  let places = 0;
  items.forEach((item, index) => {
    if (ids[item.id]) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Duplicate order line item ID", path: [index, "id"] });
    }
    ids[item.id] = true;
    places += item.quantity;
  });
  if (places > 100) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "CDEK supports at most 100 places", path: [] });
  }
});

const orderSchema = z.object({ items: orderItemsSchema }).passthrough();
const fulfillmentItemsSchema = z.array(z.object({
  line_item_id: z.string().trim().min(1).max(200),
  quantity: z.number().int().positive().max(100),
}).passthrough()).min(1).max(100).superRefine((items, context) => {
  const ids: Record<string, true> = Object.create(null);
  items.forEach((item, index) => {
    if (ids[item.line_item_id]) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Duplicate fulfillment line item ID", path: [index, "line_item_id"] });
    }
    ids[item.line_item_id] = true;
  });
  if (items.reduce((total, item) => total + item.quantity, 0) > 100) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "CDEK supports at most 100 places", path: [] });
  }
});

const manifestEntrySchema = z.object({
  variant_id: z.string().trim().min(1).max(200),
  unit_price: z.number().finite().nonnegative().max(50_000_000),
  unit_index: z.number().int().positive().max(100),
  number: z.string().min(1).max(30),
  weight: z.number().int().positive().max(30_000),
  length: z.number().int().positive().max(120),
  width: z.number().int().positive().max(120),
  height: z.number().int().positive().max(120),
}).strict();
const manifestSchema = z.array(manifestEntrySchema).min(1).max(100);
export type CdekPackageManifest = z.infer<typeof manifestSchema>;

function parseWithSchema<T>(
  schema: z.ZodType<T, unknown>,
  data: unknown,
  mode: string,
): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    const fields = result.error.issues.map((issue) => issue.path.join(".")).join(", ");
    throw new CdekFulfillmentDataError(`${mode}: ${fields}`);
  }
  return result.data;
}

export function parseDestinationCityCode(value: unknown) {
  return parseWithSchema(cityCodeSchema, value, "city_code");
}

export function parsePvzSelection(data: Record<string, unknown>) {
  return parseWithSchema(pvzSelectionSchema, data, CDEK_OPTION_PVZ);
}

export function parseCourierSelection(data: Record<string, unknown>) {
  return parseWithSchema(courierSelectionSchema, data, CDEK_OPTION_COURIER);
}

export function parseDeliveryMode(data: Record<string, unknown>) {
  return parseWithSchema(
    z.object({ delivery_mode: deliveryModeSchema }),
    data,
    "delivery_mode",
  ).delivery_mode;
}

export function resolvePickupStore(data: Record<string, unknown>) {
  const selection = parseWithSchema(pickupSelectionSchema, data, CDEK_OPTION_PICKUP);
  const store = MOSCOW_PICKUP_STORES.find(
    (candidate) => candidate.id === selection.pickup_store_id,
  );
  if (!store) {
    throw new CdekFulfillmentDataError(`unknown pickup store ${String(data["pickup_store_id"])}`);
  }
  return store;
}

function comparePlaces(a: CdekPackageManifest[number], b: CdekPackageManifest[number]) {
  return a.number < b.number ? -1 : a.number > b.number ? 1 : 0;
}

export function buildCdekCartPackages(items: unknown): CdekPackageManifest {
  return buildMeasuredPackages(parseWithSchema(orderItemsSchema, items, "cart items"));
}

function buildMeasuredPackages(lines: z.infer<typeof orderItemsSchema>): CdekPackageManifest {
  const groups: Record<string, { place: Omit<CdekPackageManifest[number], "number" | "unit_index">; quantity: number }> = Object.create(null);
  for (const item of lines) {
    const physical = parseWithSchema(packageSchema, {
      weight: item.variant?.weight ?? item.variant?.product?.weight ?? item.product?.weight,
      length: item.variant?.length ?? item.variant?.product?.length ?? item.product?.length,
      width: item.variant?.width ?? item.variant?.product?.width ?? item.product?.width,
      height: item.variant?.height ?? item.variant?.product?.height ?? item.product?.height,
    }, `physical attributes for ${item.id}`);
    const variantId = requireText(item.variant_id ?? item.variant?.id, "item variant identity");
    const unitPrice = item.unit_price;
    const key = JSON.stringify([variantId, unitPrice, physical.weight, physical.length, physical.width, physical.height]);
    if (groups[key]) {
      groups[key].quantity += item.quantity;
    } else {
      groups[key] = { place: { variant_id: variantId, unit_price: unitPrice, ...physical }, quantity: item.quantity };
    }
  }
  const packages: CdekPackageManifest = [];
  for (const [key, { place, quantity }] of Object.entries(groups)) {
    const identity = createHash("sha256").update(key).digest("hex").slice(0, 24);
    for (let unitIndex = 1; unitIndex <= quantity; unitIndex += 1) {
      packages.push({ ...place, unit_index: unitIndex, number: `${identity}-${unitIndex}` });
    }
  }
  return packages.sort(comparePlaces);
}

export function buildCdekPackages(items: unknown[], order: Record<string, unknown> | undefined) {
  const parsedOrder = parseWithSchema(orderSchema, order ?? {}, "order items");
  const fulfillmentItems = parseWithSchema(fulfillmentItemsSchema, items, "fulfillment items");
  const quantities: Record<string, number> = Object.create(null);
  for (const item of fulfillmentItems) {
    quantities[item.line_item_id] = item.quantity;
    if (!parsedOrder.items.some((line) => line.id === item.line_item_id)) {
      throw new CdekFulfillmentDataError(`unmatched line item ${item.line_item_id}`);
    }
  }
  // The paid manifest represents the whole order, never a partial fulfillment.
  if (parsedOrder.items.some((line) => quantities[line.id] !== line.quantity)) {
    throw new CdekFulfillmentDataError("fulfillment composition differs from the quoted order");
  }
  return buildMeasuredPackages(parsedOrder.items);
}

export function validateCdekPackages(data: Record<string, unknown>, packages: CdekPackageManifest) {
  const saved = parseWithSchema(manifestSchema, data["validated_packages"], "validated packages").sort(comparePlaces);
  if (saved.length !== packages.length || saved.some((place, index) => {
    const current = packages[index];
    return place.unit_index !== current.unit_index ||
      place.variant_id !== current.variant_id || place.unit_price !== current.unit_price ||
      place.number !== current.number || place.weight !== current.weight ||
      place.length !== current.length || place.width !== current.width || place.height !== current.height;
  })) {
    throw new CdekFulfillmentDataError("packages changed since checkout");
  }
}

export function cdekTariffPackages(packages: CdekPackageManifest) {
  return packages.map(({ weight, length, width, height }) => ({ weight, length, width, height }));
}

export function buildCdekOrderPackages(packages: CdekPackageManifest, order: Record<string, unknown> | undefined) {
  if (order?.currency_code !== "rub") {
    throw new CdekFulfillmentDataError("RUB order currency is required for declared item prices");
  }
  const lines = parseWithSchema(orderSchema, order, "order items").items;
  const itemDetails: Record<string, { name: string; ware_key: string }> = Object.create(null);
  for (const line of lines) {
    const variantId = requireText(line.variant_id ?? line.variant?.id, "item variant identity");
    const name = parseWithSchema(z.string().trim().min(1).max(255), line.title, "item title");
    const wareKey = parseWithSchema(z.string().min(1).max(50).regex(/^[A-Za-zА-Яа-яЁё0-9 !@"#№$;%^:&?*()_+=<>,.{}\[\]/-]+$/u), variantId, "item identity");
    itemDetails[JSON.stringify([variantId, line.unit_price])] = { name, ware_key: wareKey };
  }
  return packages.map((place) => {
    const details = itemDetails[JSON.stringify([place.variant_id, place.unit_price])];
    if (!details) throw new CdekFulfillmentDataError("package item is absent from order");
    return {
      number: place.number,
      weight: place.weight,
      length: place.length,
      width: place.width,
      height: place.height,
      items: [{ ...details, cost: place.unit_price, weight: place.weight, amount: 1 as const, payment: { value: 0 as const } }],
    };
  });
}

export function requireText(value: unknown, field: string): string {
  const result = requiredTextSchema.safeParse(value);
  if (!result.success) {
    throw new CdekFulfillmentDataError(field);
  }
  return result.data;
}
