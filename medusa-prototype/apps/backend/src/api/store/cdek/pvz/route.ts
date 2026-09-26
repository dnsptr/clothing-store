import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { z } from "zod";

import type { CdekDeliveryPoint } from "../../../../modules/cdek/lib/cdek-client";
import {
  getPublicCdekClient,
  PublicCdekGuardError,
  publicCdekGuard,
} from "../../../../modules/cdek/public-api";

const POSITIVE_INTEGER_TEXT = z.string().regex(/^\d+$/u).transform(Number);
const PVZ_QUERY_SCHEMA = z.object({
  city_code: POSITIVE_INTEGER_TEXT.pipe(z.number().int().min(1).max(10_000_000)),
  limit: POSITIVE_INTEGER_TEXT.pipe(z.number().int().min(1).max(100)).default(100),
});

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    publicCdekGuard.checkRate(req);
  } catch (error) {
    if (error instanceof PublicCdekGuardError && error.reason === "rate_limited") {
      return res.status(429).json({ message: "Too many requests", pvz: [] });
    }
    throw error;
  }

  const queryResult = PVZ_QUERY_SCHEMA.safeParse(req.query);
  if (!queryResult.success) {
    return res.status(400).json({
      message: "Invalid request",
      pvz: [],
    });
  }

  let client;
  try {
    client = getPublicCdekClient();
  } catch {
    return res.status(503).json({ message: "Delivery service unavailable", pvz: [] });
  }
  if (client === null) {
    return res.status(503).json({
      message: "Delivery service unavailable",
      pvz: [],
    });
  }

  try {
    const { city_code: cityCode, limit } = queryResult.data;
    const pvz = await publicCdekGuard.run<CdekDeliveryPoint[]>({
      key: `pvz:${cityCode}:${limit}`,
      cacheTtlMs: 60_000,
      execute: () => client.getDeliveryPoints(cityCode),
    });
    return res.json({ pvz: pvz.slice(0, limit) });
  } catch (error) {
    if (error instanceof PublicCdekGuardError) {
      const status = error.reason === "rate_limited" ? 429 : 503;
      const message = error.reason === "rate_limited" ? "Too many requests" : "Delivery service busy";
      return res.status(status).json({ message, pvz: [] });
    }
    return res.status(502).json({ message: "Delivery provider unavailable", pvz: [] });
  }
}
