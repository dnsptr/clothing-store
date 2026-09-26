import { z } from "zod";

import type { PochtaOrderParams } from "./lib/pochta-client";
import { POCHTA_OPTION_COURIER, POCHTA_OPTION_PARCEL } from "./provider-id";
import { packageSchema, postalIndexSchema } from "./schemas";

const boundedText = z.string().trim().min(1).max(500);
const selectionSchema = z.object({
  postal_code: postalIndexSchema,
  post_office_address: boundedText.optional(),
  delivery_address: boundedText.optional(),
  weight_grams: z.number().int().positive().max(20_000).optional(),
  length_cm: z.number().int().positive().max(200).optional(),
  width_cm: z.number().int().positive().max(200).optional(),
  height_cm: z.number().int().positive().max(200).optional(),
}).passthrough();
const shippingAddressSchema = z.object({
  first_name: z.string().trim().min(1).max(100).optional(),
  last_name: z.string().trim().min(1).max(100).optional(),
  phone: z.string().trim().regex(/^\+[1-9]\d{9,14}$/u),
  address_1: boundedText,
  address_2: z.string().trim().min(1).max(200).optional(),
  city: z.string().trim().min(1).max(100),
  province: z.string().trim().min(1).max(100).optional(),
  postal_code: postalIndexSchema,
}).refine((address) => Boolean(address.first_name || address.last_name));
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
  id: z.string().trim().min(1).max(200).optional(),
  display_id: z.union([z.string().trim().min(1).max(200), z.number().int().nonnegative()]).optional(),
  shipping_address: shippingAddressSchema,
  items: z.array(orderItemSchema).min(1),
}).refine((order) => order.id !== undefined || order.display_id !== undefined);
const fulfillmentItemSchema = z.object({
  line_item_id: z.string().trim().min(1).max(200),
  quantity: z.number().int().positive().max(1_000),
}).passthrough();
const fulfillmentItemsSchema = z.array(fulfillmentItemSchema).min(1).max(100).superRefine((items, context) => {
  const lineItemIds = new Set<string>();
  items.forEach((item, index) => {
    if (lineItemIds.has(item.line_item_id)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Duplicate line item ID",
        path: [index, "line_item_id"],
      });
    }
    lineItemIds.add(item.line_item_id);
  });
});
const physicalAttributesSchema = z.object({
  weight: z.number().finite().positive(),
  length: z.number().finite().positive(),
  width: z.number().finite().positive(),
  height: z.number().finite().positive(),
});

export class PochtaFulfillmentDataError extends Error {
  readonly name = "PochtaFulfillmentDataError";
  constructor(readonly detail: string) {
    super(`Invalid Russian Post fulfillment data: ${detail}`);
  }
}

export class UnsupportedPochtaCancellationError extends Error {
  readonly name = "UnsupportedPochtaCancellationError";
  constructor() {
    super("Russian Post fulfillment cancellation is unsupported");
  }
}

export function parsePochtaOption(optionId: unknown): typeof POCHTA_OPTION_PARCEL | typeof POCHTA_OPTION_COURIER {
  if (optionId === POCHTA_OPTION_PARCEL || optionId === POCHTA_OPTION_COURIER) {
    return optionId;
  }
  throw new PochtaFulfillmentDataError("option");
}

export function parsePochtaDeliveryMode(data: Record<string, unknown>): typeof POCHTA_OPTION_PARCEL | typeof POCHTA_OPTION_COURIER {
  const mode = data["delivery_mode"];
  if (mode === POCHTA_OPTION_PARCEL || mode === POCHTA_OPTION_COURIER) {
    return mode;
  }
  throw new PochtaFulfillmentDataError("delivery mode");
}

function parse<T>(schema: { safeParse(value: unknown): { success: true; data: T } | { success: false } }, value: unknown, detail: string): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new PochtaFulfillmentDataError(detail);
  return result.data;
}

export function validatePochtaSelection(optionId: unknown, data: Record<string, unknown>) {
  const parsedOptionId = parsePochtaOption(optionId);
  const selection = parse(selectionSchema, data, "selection");
  if (parsedOptionId === POCHTA_OPTION_PARCEL && !selection.post_office_address) {
    throw new PochtaFulfillmentDataError("post office address");
  }
  if (parsedOptionId === POCHTA_OPTION_COURIER && !selection.delivery_address) {
    throw new PochtaFulfillmentDataError("delivery address");
  }
  return selection;
}

export function buildPochtaCartPackage(items: unknown) {
  const cartItems = parse(z.array(orderItemSchema.extend({
    quantity: z.number().int().positive().max(1_000),
  })).min(1).max(100), items, "cart items");
  const measured = cartItems.map((item) => {
    const physical = parse(physicalAttributesSchema, {
      weight: item.variant?.weight ?? item.variant?.product?.weight ?? item.product?.weight,
      length: item.variant?.length ?? item.variant?.product?.length ?? item.product?.length,
      width: item.variant?.width ?? item.variant?.product?.width ?? item.product?.width,
      height: item.variant?.height ?? item.variant?.product?.height ?? item.product?.height,
    }, "item physical attributes");
    return { quantity: item.quantity, ...physical };
  });
  return parse(packageSchema, {
    weightGrams: measured.reduce((total, item) => total + item.weight * item.quantity, 0),
    lengthCm: Math.max(...measured.map((item) => item.length)),
    widthCm: Math.max(...measured.map((item) => item.width)),
    heightCm: Math.max(...measured.map((item) => item.height)),
  }, "package");
}

export function buildBacklogOrderParams(
  data: Record<string, unknown>,
  items: unknown[],
  order: Record<string, unknown> | undefined,
  isCourier: boolean,
): PochtaOrderParams {
  const selection = validatePochtaSelection(isCourier ? POCHTA_OPTION_COURIER : POCHTA_OPTION_PARCEL, data);
  const parsedOrder = parse(orderSchema, order, "order");
  const parsedItems = parse(fulfillmentItemsSchema, items, "items");
  const matchedItems = parsedItems.map((fulfillmentItem) => {
    const orderItem = parsedOrder.items.find((item) => item.id === fulfillmentItem.line_item_id);
    if (!orderItem) throw new PochtaFulfillmentDataError("line item");
    const physicalAttributes = parse(physicalAttributesSchema, {
      weight: orderItem.variant?.weight ?? orderItem.variant?.product?.weight ?? orderItem.product?.weight,
      length: orderItem.variant?.length ?? orderItem.variant?.product?.length ?? orderItem.product?.length,
      width: orderItem.variant?.width ?? orderItem.variant?.product?.width ?? orderItem.product?.width,
      height: orderItem.variant?.height ?? orderItem.variant?.product?.height ?? orderItem.product?.height,
    }, "item physical attributes");
    return { quantity: fulfillmentItem.quantity, ...physicalAttributes };
  });
  const packageData = parse(packageSchema, {
    weightGrams: matchedItems.reduce((total, item) => total + item.weight * item.quantity, 0),
    lengthCm: Math.max(...matchedItems.map((item) => item.length)),
    widthCm: Math.max(...matchedItems.map((item) => item.width)),
    heightCm: Math.max(...matchedItems.map((item) => item.height)),
  }, "package");
  const address = parsedOrder.shipping_address;
  if (isCourier && selection.postal_code !== address.postal_code) {
    throw new PochtaFulfillmentDataError("postal index mismatch");
  }
  const recipientName = [address.first_name, address.last_name]
    .filter((part): part is string => part !== undefined).join(" ");
  const courierAddress = [address.province, address.city, address.address_1, address.address_2]
    .filter((part): part is string => part !== undefined).join(", ");
  return {
    orderNumber: String(parsedOrder.display_id ?? parsedOrder.id),
    toIndex: selection.postal_code,
    recipientAddress: isCourier ? courierAddress : selection.post_office_address ?? "",
    recipientName,
    recipientPhone: address.phone,
    ...packageData,
    isCourier,
  };
}
