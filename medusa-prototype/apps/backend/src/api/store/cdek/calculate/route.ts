import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { z } from "zod";

import type { CdekPackage, CdekTariffResult } from "../../../../modules/cdek/lib/cdek-client";
import { CDEK_TARIFF_COURIER, CDEK_TARIFF_PVZ } from "../../../../modules/cdek/provider-id";
import {
  getPublicCdekClient,
  PublicCdekGuardError,
  publicCdekGuard,
} from "../../../../modules/cdek/public-api";

const DIMENSION_SCHEMA = z.number().finite().positive().max(120);
const CALCULATION_SCHEMA = z.object({
  to_city_code: z.number().int().min(1).max(10_000_000),
  tariff_code: z.union([z.literal(CDEK_TARIFF_PVZ), z.literal(CDEK_TARIFF_COURIER)]).optional(),
  weight: z.number().finite().positive().max(30_000),
  length: DIMENSION_SCHEMA,
  width: DIMENSION_SCHEMA,
  height: DIMENSION_SCHEMA,
}).refine(({ length, width, height }) => length + width + height <= 150);

type CalculationResult = {
  readonly pvz: CdekTariffResult | null;
  readonly courier: CdekTariffResult | null;
};

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    publicCdekGuard.checkRate(req);
  } catch (error) {
    if (error instanceof PublicCdekGuardError && error.reason === "rate_limited") {
      return res.status(429).json({ message: "Too many requests" });
    }
    throw error;
  }

  const bodyResult = CALCULATION_SCHEMA.safeParse(req.body);
  if (!bodyResult.success) {
    return res.status(400).json({ message: "Invalid request" });
  }

  let client;
  try {
    client = getPublicCdekClient();
  } catch {
    return res.status(503).json({ message: "Delivery service unavailable" });
  }
  if (client === null) {
    return res.status(503).json({ message: "Delivery service unavailable" });
  }

  try {
    const body = bodyResult.data;
    const parcel: CdekPackage = {
      weight: body.weight,
      length: body.length,
      width: body.width,
      height: body.height,
    };
    const cacheKey = [body.to_city_code, body.tariff_code ?? "both", body.weight, body.length, body.width, body.height].join(":");
    const tariffs = await publicCdekGuard.run<CalculationResult>({
      key: `calculate:${cacheKey}`,
      cacheTtlMs: 30_000,
      execute: async () => {
        if (body.tariff_code === CDEK_TARIFF_PVZ) {
          const pvz = await client.calculateTariff({ toCityCode: body.to_city_code, tariffCode: CDEK_TARIFF_PVZ, packages: [parcel] });
          return { pvz, courier: null };
        }
        if (body.tariff_code === CDEK_TARIFF_COURIER) {
          const courier = await client.calculateTariff({ toCityCode: body.to_city_code, tariffCode: CDEK_TARIFF_COURIER, packages: [parcel] });
          return { pvz: null, courier };
        }
        const [pvz, courier] = await Promise.all([
          client.calculateTariff({ toCityCode: body.to_city_code, tariffCode: CDEK_TARIFF_PVZ, packages: [parcel] }),
          client.calculateTariff({ toCityCode: body.to_city_code, tariffCode: CDEK_TARIFF_COURIER, packages: [parcel] }),
        ]);
        return { pvz, courier };
      },
    });

    return res.json({
      pvz: tariffs.pvz,
      courier: tariffs.courier,
      customer_cost: 0,
    });
  } catch (error) {
    if (error instanceof PublicCdekGuardError) {
      const status = error.reason === "rate_limited" ? 429 : 503;
      const message = error.reason === "rate_limited" ? "Too many requests" : "Delivery service busy";
      return res.status(status).json({ message });
    }
    return res.status(502).json({ message: "Delivery provider unavailable" });
  }
}
