import { z } from "zod";

import {
  CDEK_OPTION_COURIER,
  CDEK_OPTION_PICKUP,
  CDEK_OPTION_PVZ,
} from "./provider-id";

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

const orderItemSchema = z.object({
  id: z.string().trim().min(1).max(200),
  variant: physicalSourceSchema.extend({
    product: physicalSourceSchema.nullish(),
  }).nullish(),
  product: physicalSourceSchema.nullish(),
}).passthrough();

const orderSchema = z.object({
  items: z.array(orderItemSchema).min(1).max(100).superRefine((items, context) => {
    const itemIds = new Set<string>();
    items.forEach((item, index) => {
      if (itemIds.has(item.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Duplicate order line item ID",
          path: [index, "id"],
        });
      }
      itemIds.add(item.id);
    });
  }),
}).passthrough();

const fulfillmentItemSchema = z.object({
  line_item_id: z.string().trim().min(1).max(200),
  quantity: z.number().int().positive().max(1_000),
}).passthrough();

const fulfillmentItemsSchema = z.array(fulfillmentItemSchema).min(1).max(100).superRefine((items, context) => {
  const itemIds = new Set<string>();
  items.forEach((item, index) => {
    if (itemIds.has(item.line_item_id)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Duplicate fulfillment line item ID",
        path: [index, "line_item_id"],
      });
    }
    itemIds.add(item.line_item_id);
  });
});

const physicalAttributesSchema = z.object({
  weight: z.number().finite().positive().max(30_000),
  length: z.number().finite().positive().max(120),
  width: z.number().finite().positive().max(120),
  height: z.number().finite().positive().max(120),
}).strict();

const packageSchema = z.object({
  weight: z.number().finite().positive().max(30_000),
  length: z.number().finite().positive().max(120),
  width: z.number().finite().positive().max(120),
  height: z.number().finite().positive().max(120),
}).strict().refine(
  ({ length, width, height }) => length + width + height <= 150,
  "CDEK package dimensions exceed the supported limit",
);

function parseWithSchema<T>(
  schema: z.ZodType<T>,
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

export function buildCdekCartPackage(items: unknown) {
  const cartItems = parseWithSchema(z.array(orderItemSchema.extend({
    quantity: z.number().int().positive().max(1_000),
  })).min(1).max(100), items, "cart items");
  const measured = cartItems.map((item) => {
    const physical = parseWithSchema(physicalAttributesSchema, {
      weight: item.variant?.weight ?? item.variant?.product?.weight ?? item.product?.weight,
      length: item.variant?.length ?? item.variant?.product?.length ?? item.product?.length,
      width: item.variant?.width ?? item.variant?.product?.width ?? item.product?.width,
      height: item.variant?.height ?? item.variant?.product?.height ?? item.product?.height,
    }, `physical attributes for ${item.id}`);
    return { quantity: item.quantity, ...physical };
  });
  return parseWithSchema(packageSchema, {
    weight: measured.reduce((total, item) => total + item.weight * item.quantity, 0),
    length: Math.max(...measured.map((item) => item.length)),
    width: Math.max(...measured.map((item) => item.width)),
    height: Math.max(...measured.map((item) => item.height)),
  }, "package");
}

export function buildCdekPackage(items: unknown[], order: Record<string, unknown> | undefined) {
  const parsedOrder = parseWithSchema(orderSchema, order ?? {}, "order items");
  const fulfillmentItems = parseWithSchema(fulfillmentItemsSchema, items, "fulfillment items");
  const matchedItems = fulfillmentItems.map((fulfillmentItem) => {
    const orderItem = parsedOrder.items.find((candidate) => candidate.id === fulfillmentItem.line_item_id);
    if (!orderItem) throw new CdekFulfillmentDataError(`unmatched line item ${fulfillmentItem.line_item_id}`);
    const physical = parseWithSchema(physicalAttributesSchema, {
      weight: orderItem.variant?.weight ?? orderItem.variant?.product?.weight ?? orderItem.product?.weight,
      length: orderItem.variant?.length ?? orderItem.variant?.product?.length ?? orderItem.product?.length,
      width: orderItem.variant?.width ?? orderItem.variant?.product?.width ?? orderItem.product?.width,
      height: orderItem.variant?.height ?? orderItem.variant?.product?.height ?? orderItem.product?.height,
    }, `physical attributes for ${fulfillmentItem.line_item_id}`);
    return { quantity: fulfillmentItem.quantity, ...physical };
  });
  return parseWithSchema(packageSchema, {
    weight: matchedItems.reduce((total, item) => total + item.weight * item.quantity, 0),
    length: Math.max(...matchedItems.map((item) => item.length)),
    width: Math.max(...matchedItems.map((item) => item.width)),
    height: Math.max(...matchedItems.map((item) => item.height)),
  }, "package");
}

export function requireText(value: unknown, field: string): string {
  const result = requiredTextSchema.safeParse(value);
  if (!result.success) {
    throw new CdekFulfillmentDataError(field);
  }
  return result.data;
}
