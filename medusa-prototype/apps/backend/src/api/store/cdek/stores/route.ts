import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";

import {
  PublicCdekGuardError,
  publicCdekGuard,
} from "../../../../modules/cdek/public-api";
import { MOSCOW_PICKUP_STORES } from "../../../../modules/cdek/service";

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    publicCdekGuard.checkRate(req);
  } catch (error) {
    if (error instanceof PublicCdekGuardError && error.reason === "rate_limited") {
      return res.status(429).json({ message: "Too many requests", stores: [] });
    }
    throw error;
  }

  try {
    const stores = await publicCdekGuard.run({
      key: "stores",
      cacheTtlMs: 60_000,
      execute: async () => MOSCOW_PICKUP_STORES,
    });
    return res.json({ stores });
  } catch (error) {
    if (error instanceof PublicCdekGuardError) {
      const status = error.reason === "rate_limited" ? 429 : 503;
      const message = error.reason === "rate_limited" ? "Too many requests" : "Delivery service busy";
      return res.status(status).json({ message, stores: [] });
    }
    return res.status(503).json({ message: "Delivery service unavailable", stores: [] });
  }
}
