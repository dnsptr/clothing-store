import { z } from "zod";

export const postalIndexSchema = z.string().regex(/^(?!000000)\d{6}$/u);
export const packageSchema = z.object({
  weightGrams: z.number().int().positive().max(20_000),
  lengthCm: z.number().int().positive().max(200),
  widthCm: z.number().int().positive().max(200),
  heightCm: z.number().int().positive().max(200),
}).strict().refine(
  ({ lengthCm, widthCm, heightCm }) => lengthCm + widthCm + heightCm <= 300,
  { message: "Package dimensions exceed Russian Post limits" },
);

export const tariffResponseSchema = z.object({
  "total-rate": z.number().finite().positive(),
  "total-vat": z.number().finite().nonnegative(),
  "delivery-time": z.object({
    "min-days": z.number().int().nonnegative(),
    "max-days": z.number().int().nonnegative(),
  }).refine((value) => value["max-days"] >= value["min-days"]),
}).passthrough();

export const postOfficeSchema = z.object({
  postal_code: postalIndexSchema,
  address_source: z.string().trim().min(1).max(500),
  latitude: z.number().finite().min(-90).max(90).optional(),
  longitude: z.number().finite().min(-180).max(180).optional(),
  work_time: z.string().trim().min(1).max(1_000).optional(),
  is_round_the_clock: z.boolean().optional(),
}).passthrough();

export const backlogResponseSchema = z.object({
  result: z.object({
    "result-ids": z.array(z.object({
      barcode: z.string().trim().regex(/^[A-Z0-9]{8,32}$/u),
      id: z.union([z.number().int().positive(), z.string().trim().min(1).max(200)]),
    }).passthrough()).min(1),
  }).passthrough(),
}).passthrough();
