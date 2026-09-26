import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { z } from "zod";

import {
  getPublicYandexClient,
  PublicYandexGuardError,
  publicYandexGuard,
} from "../../../../modules/yandex-delivery/public-api";

const querySchema = z.object({
  city: z.string().trim().min(2).max(64).regex(/^[\p{L}\d .,'’()-]+$/u).optional(),
  geo_id: z.string().trim().regex(/^\d+$/).transform(Number).optional(),
}).refine((q) => q.city !== undefined || q.geo_id !== undefined, {
  message: "Either city or geo_id must be provided",
});

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    publicYandexGuard.checkRate(req);
  } catch (error) {
    if (error instanceof PublicYandexGuardError && error.reason === "rate_limited") {
      return res.status(429).json({ message: "Too many requests", points: [] });
    }
    throw error;
  }
  const queryResult = querySchema.safeParse(req.query);
  if (!queryResult.success) {
    return res.status(400).json({ message: "Invalid request", points: [] });
  }
  let client;
  try {
    client = getPublicYandexClient();
  } catch {
    return res.status(503).json({ message: "Delivery service unavailable", points: [] });
  }
  if (client === null) {
    return res.status(503).json({ message: "Delivery service unavailable", points: [] });
  }
  try {
    const { city, geo_id } = queryResult.data;
    const cacheKey = geo_id
      ? `pvz:geo:${geo_id}`
      : `pvz:city:${city!.replace(/\s+/gu, " ").toLocaleLowerCase("ru-RU")}`;

    const points = await publicYandexGuard.run({
      key: cacheKey,
      cacheTtlMs: 60_000,
      execute: () => (geo_id !== undefined ? client.getPickupPoints({ geo_id }) : client.getPickupPoints(city!)),
    });
    return res.json({ points });
  } catch (error) {
    if (error instanceof PublicYandexGuardError) {
      const status = error.reason === "rate_limited" ? 429 : 503;
      const message = error.reason === "rate_limited" ? "Too many requests" : "Delivery service busy";
      return res.status(status).json({ message, points: [] });
    }
    return res.status(502).json({ message: "Delivery provider unavailable", points: [] });
  }
}
