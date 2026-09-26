import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { z } from "zod";

import type { YandexDetectedLocation } from "../../../../modules/yandex-delivery/lib/yandex-client";
import {
  getPublicYandexClient,
  PublicYandexGuardError,
  publicYandexGuard,
} from "../../../../modules/yandex-delivery/public-api";

const querySchema = z.object({
  query: z.string().trim().min(2).max(64),
}).strict();

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    publicYandexGuard.checkRate(req);
  } catch (error) {
    if (error instanceof PublicYandexGuardError && error.reason === "rate_limited") {
      return res.status(429).json({ message: "Too many requests", cities: [] });
    }
    throw error;
  }
  const queryResult = querySchema.safeParse(req.query);
  if (!queryResult.success) {
    return res.status(400).json({ message: "Invalid request", cities: [] });
  }
  let client;
  try {
    client = getPublicYandexClient();
  } catch {
    return res.status(503).json({ message: "Delivery service unavailable", cities: [] });
  }
  if (client === null) {
    return res.status(503).json({ message: "Delivery service unavailable", cities: [] });
  }
  try {
    const q = queryResult.data.query.replace(/\s+/gu, " ");
    const variants = await publicYandexGuard.run<YandexDetectedLocation[]>({
      key: `cities:${q.toLocaleLowerCase("ru-RU")}`,
      cacheTtlMs: 300_000, // 5 min cache
      execute: () => client.detectLocation(q),
    });
    return res.json({
      cities: variants.map((v) => ({
        geo_id: v.geo_id,
        city: v.address,
      })),
    });
  } catch (error) {
    if (error instanceof PublicYandexGuardError) {
      const status = error.reason === "rate_limited" ? 429 : 503;
      const message = error.reason === "rate_limited" ? "Too many requests" : "Delivery service busy";
      return res.status(status).json({ message, cities: [] });
    }
    return res.status(502).json({ message: "Delivery provider unavailable", cities: [] });
  }
}
