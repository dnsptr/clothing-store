import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { z } from "zod";

import type { CdekCity } from "../../../../modules/cdek/lib/cdek-client";
import {
  getPublicCdekClient,
  PublicCdekGuardError,
  publicCdekGuard,
} from "../../../../modules/cdek/public-api";

const CITY_QUERY_SCHEMA = z.preprocess(
  (value) => typeof value === "string"
    ? value.normalize("NFKC").trim().replace(/\s+/gu, " ")
    : value,
  z.string().min(2).max(64).regex(/^[\p{L}\p{M}\d .'-]+$/u),
);

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    publicCdekGuard.checkRate(req);
  } catch (error) {
    if (error instanceof PublicCdekGuardError && error.reason === "rate_limited") {
      return res.status(429).json({ message: "Too many requests", cities: [] });
    }
    throw error;
  }

  const queryResult = CITY_QUERY_SCHEMA.safeParse(req.query.query);
  if (!queryResult.success) {
    return res.status(400).json({ message: "Invalid request", cities: [] });
  }

  let client;
  try {
    client = getPublicCdekClient();
  } catch {
    return res.status(503).json({ message: "Delivery service unavailable", cities: [] });
  }
  if (client === null) {
    return res.status(503).json({
      message: "Delivery service unavailable",
      cities: [],
    });
  }

  try {
    const query = queryResult.data;
    const cities = await publicCdekGuard.run<CdekCity[]>({
      key: `cities:${query.toLocaleLowerCase("ru-RU")}`,
      cacheTtlMs: 60_000,
      execute: () => client.searchCities(query, 15),
    });
    return res.json({ cities: cities.slice(0, 15) });
  } catch (error) {
    if (error instanceof PublicCdekGuardError) {
      const status = error.reason === "rate_limited" ? 429 : 503;
      const message = error.reason === "rate_limited" ? "Too many requests" : "Delivery service busy";
      return res.status(status).json({ message, cities: [] });
    }
    return res.status(502).json({ message: "Delivery provider unavailable", cities: [] });
  }
}
