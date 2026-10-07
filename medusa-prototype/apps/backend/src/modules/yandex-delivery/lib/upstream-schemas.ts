import { z } from "zod";

const boundedText = z.string().trim().min(1).max(500);

export const locationDetectResponseSchema = z.object({
  variants: z.array(
    z.object({
      geo_id: z.number().int().nonnegative(),
      address: boundedText,
    }).passthrough(),
  ),
}).passthrough();

const positionSchema = z.union([
  z.object({
    latitude: z.number().finite().min(-90).max(90),
    longitude: z.number().finite().min(-180).max(180),
  }),
  z.tuple([
    z.number().finite().min(-180).max(180), // lon
    z.number().finite().min(-90).max(90), // lat
  ]).transform(([lon, lat]) => ({ latitude: lat, longitude: lon })),
]);

const addressSchema = z.object({
  full_address: boundedText.optional(),
  locality: z.string().trim().optional(),
  city: z.string().trim().optional(),
  street: z.string().trim().optional(),
  house: z.string().trim().optional(),
  geoId: z.number().int().optional(),
  geo_id: z.number().int().optional(),
  postal_code: z.string().trim().optional(),
  comment: z.string().trim().optional(),
}).passthrough().transform((addr) => ({
  full_address: addr.full_address || [addr.locality || addr.city, addr.street, addr.house].filter(Boolean).join(", "),
  city: addr.city || addr.locality || "",
  street: addr.street,
  house: addr.house,
  geo_id: addr.geo_id ?? addr.geoId,
  postal_code: addr.postal_code,
  comment: addr.comment,
})).refine((addr) => Boolean(addr.full_address), "Pickup point must have a verifiable address");

export const pickupStationSchema = z.object({
  id: boundedText,
  name: boundedText,
  type: z.enum(["pickup_point", "terminal", "warehouse"]).default("pickup_point"),
  operator_id: z.string().trim().optional(),
  operator_station_id: z.string().trim().optional(),
  position: positionSchema,
  address: addressSchema,
  instruction: z.string().trim().optional(),
  contact: z.object({
    phone: z.string().trim().optional(),
    first_name: z.string().trim().optional(),
  }).passthrough().optional(),
  phones: z.array(z.object({ number: z.string().trim() })).optional(),
  schedule: z.any().optional(),
  pickup_services: z.object({
    is_fitting_allowed: z.boolean().optional(),
    is_partial_refuse_allowed: z.boolean().optional(),
    is_paperless_pickup_allowed: z.boolean().optional(),
    is_unboxing_allowed: z.boolean().optional(),
  }).passthrough().optional(),
}).passthrough().transform((station) => {
  const phone = station.contact?.phone ?? station.phones?.[0]?.number;
  return {
    id: station.id,
    name: station.name,
    type: station.type,
    operatorId: station.operator_id,
    position: station.position,
    address: station.address,
    instruction: station.instruction,
    phone,
    isFittingAllowed: Boolean(station.pickup_services?.is_fitting_allowed),
    isPartialRefuseAllowed: Boolean(station.pickup_services?.is_partial_refuse_allowed),
  };
});

export const pickupPointsResponseSchema = z.object({
  points: z.array(pickupStationSchema),
}).passthrough();

export const pricingCalculatorResponseSchema = z.object({
  pricing_total: z.string().trim().regex(/^\d+(?:\.\d{1,2})? RUB$/u),
  delivery_days: z.number().int().nonnegative().optional(),
}).transform((val) => ({
  priceRub: Number(val.pricing_total.slice(0, -4)),
  deliveryDays: val.delivery_days,
  currency: "RUB" as const,
})).refine((quote) => Number.isFinite(quote.priceRub) && quote.priceRub > 0);

export const offerCreateResponseSchema = z.object({
  offers: z.array(z.object({ offer_id: boundedText })).min(1),
}).transform((val) => ({ offer_id: val.offers[0].offer_id }));

export const offerConfirmResponseSchema = z.object({
  request_id: boundedText,
});

export const requestInfoResponseSchema = z.object({
  request_id: boundedText,
  state: z.object({ status: boundedText }),
}).transform((val) => ({
  requestId: val.request_id,
  status: val.state.status,
}));

export const cancellationResponseSchema = z.object({
  status: z.enum(["CREATED", "SUCCESS", "ERROR"]),
  reason: z.string().optional(),
});
