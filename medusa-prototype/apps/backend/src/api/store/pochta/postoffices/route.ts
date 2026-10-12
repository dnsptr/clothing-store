import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { z } from "zod";

import type { PochtaPostOffice } from "../../../../modules/pochta/lib/pochta-client";
import {
  _resetPublicPochtaForTesting,
  getPublicPochtaClient,
  PublicPochtaGuardError,
  publicPochtaGuard,
} from "../../../../modules/pochta/public-api";
import { postalIndexSchema } from "../../../../modules/pochta/schemas";

const querySchema = z.object({ postal_code: postalIndexSchema }).strict();

export function _resetClientForTesting(): void {
  _resetPublicPochtaForTesting();
}

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    publicPochtaGuard.checkRate(req);
  } catch (error) {
    if (error instanceof PublicPochtaGuardError && error.reason === "rate_limited") {
      return res.status(429).json({ message: "Too many requests", offices: [] });
    }
    throw error;
  }
  const queryResult = querySchema.safeParse(req.query);
  if (!queryResult.success) return res.status(400).json({ message: "Invalid request", offices: [] });
  let client;
  try {
    client = getPublicPochtaClient();
  } catch {
    return res.status(503).json({ message: "Delivery service unavailable", offices: [] });
  }
  if (client === null) {
    return res.status(503).json({ message: "Delivery service unavailable", offices: [] });
  }
  try {
    const postalCode = queryResult.data.postal_code;
    const offices = await publicPochtaGuard.run<PochtaPostOffice[]>({
      key: `postoffices:${postalCode}`,
      cacheTtlMs: 60_000,
      execute: () => client.getNearbyPostOffices(postalCode),
    });
    return res.json({ offices });
  } catch (error) {
    if (error instanceof PublicPochtaGuardError) {
      const status = error.reason === "rate_limited" ? 429 : 503;
      const message = error.reason === "rate_limited" ? "Too many requests" : "Delivery service busy";
      return res.status(status).json({ message, offices: [] });
    }
    return res.status(502).json({ message: "Delivery provider unavailable", offices: [] });
  }
}
