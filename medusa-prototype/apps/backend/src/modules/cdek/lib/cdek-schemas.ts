import { z } from "@medusajs/framework/zod";

import { CDEK_TARIFF_COURIER, CDEK_TARIFF_PVZ } from "../provider-id";

export const textSchema = z.string().trim().min(1).max(500);
export const identifierSchema = z.string().trim().min(1).max(200);
export const cityCodeSchema = z.number().int().positive().max(10_000_000);
export const supportedTariffCodeSchema = z.union([
  z.literal(CDEK_TARIFF_PVZ),
  z.literal(CDEK_TARIFF_COURIER),
]);
const packageWeightSchema = z.number().int().positive().max(30_000);
const dimensionSchema = z.number().int().positive().max(120);

const packageDataSchema = z.object({
  weight: packageWeightSchema,
  length: dimensionSchema,
  width: dimensionSchema,
  height: dimensionSchema,
}).strict();

export const packageSchema = packageDataSchema.refine(
  ({ length, width, height }) => length + width + height <= 150,
  "CDEK package dimensions exceed the supported limit",
);

export const citySchema = z.object({
  code: cityCodeSchema,
  city: textSchema,
  region: textSchema.optional(),
  sub_region: textSchema.optional(),
  fias_guid: identifierSchema.optional(),
  kladr_code: identifierSchema.optional(),
}).passthrough();

export const deliveryPointSchema = z.object({
  code: identifierSchema,
  name: textSchema,
  type: z.union([z.literal("PVZ"), z.literal("POSTAMAT")]),
  is_reception: z.boolean().nullable().optional(),
  location: z.object({
    address: textSchema,
    address_full: textSchema.optional(),
    city_code: cityCodeSchema,
    city: textSchema,
    latitude: z.number().finite().min(-90).max(90).optional(),
    longitude: z.number().finite().min(-180).max(180).optional(),
  }).passthrough(),
  work_time: textSchema,
  phones: z.array(z.object({ number: textSchema }).passthrough()).max(20).optional(),
  note: textSchema.optional(),
  nearest_metro_station: textSchema.optional(),
}).passthrough();

export const tariffResponseSchema = z.object({
  delivery_sum: z.number().finite().nonnegative().max(100_000_000),
  period_min: z.number().int().nonnegative().max(365),
  period_max: z.number().int().nonnegative().max(365),
  delivery_date_range: z.object({
    min: textSchema.optional(),
    max: textSchema.optional(),
  }).passthrough().optional(),
}).passthrough().refine(
  ({ period_min: periodMin, period_max: periodMax }) => periodMin <= periodMax,
  "CDEK tariff period is invalid",
);

export const orderResponseSchema = z.object({
  entity: z.object({ uuid: identifierSchema }).passthrough(),
  requests: z.array(z.object({
    request_uuid: identifierSchema,
    type: identifierSchema,
    state: identifierSchema,
    date_time: textSchema,
  }).passthrough()).min(1).max(100),
}).passthrough();

export const orderDetailsSchema = z.object({
  entity: z.object({
    uuid: identifierSchema,
    cdek_number: identifierSchema.optional(),
    statuses: z.array(z.object({
      code: identifierSchema,
      name: textSchema,
      date_time: textSchema,
    }).passthrough()).min(1).max(100),
  }).passthrough(),
}).passthrough();

export const tokenResponseSchema = z.object({
  access_token: z.string().trim().min(1).max(8_192),
  expires_in: z.number().int().positive().max(86_400),
}).passthrough();

export const errorResponseSchema = z.object({
  message: textSchema.optional(),
  errors: z.array(z.object({
    message: textSchema,
    code: identifierSchema,
  }).passthrough()).min(1).max(100).optional(),
}).passthrough();

const phoneSchema = z.string().trim().regex(/^\+[1-9]\d{9,14}$/u);
const emailSchema = z.string().trim().email().max(320);
const orderItemSchema = z.object({
  name: z.string().trim().min(1).max(255),
  ware_key: z.string().min(1).max(50).regex(/^[A-Za-zА-Яа-яЁё0-9 !@"#№$;%^:&?*()_+=<>,.{}\[\]/-]+$/u),
  // CDEK MoneyDto: prepaid payment is zero, so VAT does not apply.
  payment: z.object({ value: z.literal(0) }).strict(),
  weight: packageWeightSchema,
  amount: z.literal(1),
  cost: z.number().finite().nonnegative().max(50_000_000),
}).strict();
const orderPackageSchema = packageDataSchema.extend({
  number: z.string().trim().min(1).max(30),
  items: z.array(orderItemSchema).length(1),
}).refine(
  ({ length, width, height }) => length + width + height <= 150,
  "CDEK package dimensions exceed the supported limit",
);
const destinationSchema = z.object({
  cityCode: cityCodeSchema,
  address: textSchema,
}).strict();

export const recipientSchema = z.object({
  name: textSchema,
  phones: z.array(z.object({ number: phoneSchema }).strict()).min(1).max(20),
  email: emailSchema.optional(),
}).strict();

export const createOrderInputSchema = z.object({
  orderNumber: z.string().trim().min(1).max(40).regex(/^[\x20-\x7e]+$/u),
  tariffCode: supportedTariffCodeSchema,
  shipmentPoint: z.string().trim().min(1).max(255),
  recipient: recipientSchema,
  packages: z.array(orderPackageSchema).min(1).max(100),
  deliveryPoint: identifierSchema.optional(),
  toAddress: destinationSchema.optional(),
  comment: z.string().trim().min(1).max(255).optional(),
}).strict().superRefine((order, context) => {
  if ((order.deliveryPoint === undefined) === (order.toAddress === undefined)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Exactly one CDEK delivery destination is required",
      path: ["deliveryPoint"],
    });
  }
  const numbers: Record<string, true> = Object.create(null);
  order.packages.forEach((place, index) => {
    if (numbers[place.number]) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Duplicate package number", path: ["packages", index, "number"] });
    }
    numbers[place.number] = true;
  });
});

export type CdekCity = z.infer<typeof citySchema>;
export type CdekDeliveryPoint = z.infer<typeof deliveryPointSchema>;
export type CdekPackage = z.infer<typeof packageSchema>;
export type CdekOrderResponse = z.infer<typeof orderResponseSchema>;
export type CdekOrderPackage = z.infer<typeof orderPackageSchema>;
