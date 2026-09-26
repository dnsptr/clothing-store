import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { z } from "zod";

import type { PochtaTariffResult } from "../../../../modules/pochta/lib/pochta-client";
import {
  _resetPublicPochtaForTesting,
  getPublicPochtaClient,
  PublicPochtaGuardError,
  publicPochtaGuard,
} from "../../../../modules/pochta/public-api";
import { packageSchema, postalIndexSchema } from "../../../../modules/pochta/schemas";

const calculationSchema = z.object({
  to_index: postalIndexSchema,
  weight: z.number(),
  length: z.number(),
  width: z.number(),
  height: z.number(),
  is_courier: z.boolean().optional(),
}).strict().transform((value, context) => {
  const parcel = packageSchema.safeParse({
    weightGrams: value.weight,
    lengthCm: value.length,
    widthCm: value.width,
    heightCm: value.height,
  });
  if (!parcel.success) {
    context.addIssue({ code: "custom", message: "Invalid package" });
    return z.NEVER;
  }
  return { toIndex: value.to_index, ...parcel.data };
});

export function _resetClientForTesting(): void {
  _resetPublicPochtaForTesting();
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    publicPochtaGuard.checkRate(req);
  } catch (error) {
    if (error instanceof PublicPochtaGuardError && error.reason === "rate_limited") {
      return res.status(429).json({ message: "Too many requests" });
    }
    throw error;
  }
  const bodyResult = calculationSchema.safeParse(req.body);
  if (!bodyResult.success) return res.status(400).json({ message: "Invalid request" });
  let client;
  try {
    client = getPublicPochtaClient();
  } catch {
    return res.status(503).json({ message: "Delivery service unavailable" });
  }
  if (client === null) return res.status(503).json({ message: "Delivery service unavailable" });
  try {
    const input = bodyResult.data;
    const [parcel, courier] = await publicPochtaGuard.run<readonly [PochtaTariffResult, PochtaTariffResult]>({
      key: `calculate:${JSON.stringify(input)}`,
      cacheTtlMs: 30_000,
      execute: () => Promise.all([
        client.calculateTariff({ ...input, isCourier: false }),
        client.calculateTariff({ ...input, isCourier: true }),
      ]),
    });
    return res.json({ parcel, courier, customer_cost: 0 });
  } catch (error) {
    if (error instanceof PublicPochtaGuardError) {
      const status = error.reason === "rate_limited" ? 429 : 503;
      const message = error.reason === "rate_limited" ? "Too many requests" : "Delivery service busy";
      return res.status(status).json({ message });
    }
    return res.status(502).json({ message: "Delivery provider unavailable" });
  }
}
