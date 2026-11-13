import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { z } from "@medusajs/framework/zod";

import type { CdekTariffResult } from "../../../../modules/cdek/lib/cdek-client";
import { packageSchema } from "../../../../modules/cdek/lib/cdek-schemas";
import { CDEK_TARIFF_COURIER, CDEK_TARIFF_PVZ } from "../../../../modules/cdek/provider-id";
import { parseCdekEnvironment } from "../../../../modules/cdek/config";
import {
  getPublicCdekClient,
  PublicCdekGuardError,
  publicCdekGuard,
} from "../../../../modules/cdek/public-api";

const CALCULATION_SCHEMA = z.object({
  to_city_code: z.number().int().min(1).max(10_000_000),
  tariff_code: z.union([z.literal(CDEK_TARIFF_PVZ), z.literal(CDEK_TARIFF_COURIER)]).optional(),
  packages: z.array(packageSchema).min(1).max(100),
}).strict();

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
    const cacheKey = JSON.stringify([body.to_city_code, body.tariff_code ?? "both", body.packages]);
    const tariffs = await publicCdekGuard.run<CalculationResult>({
      key: `calculate:${cacheKey}`,
      cacheTtlMs: 30_000,
      execute: async () => {
        if (body.tariff_code === CDEK_TARIFF_PVZ) {
          const pvz = await client.calculateTariff({ toCityCode: body.to_city_code, tariffCode: CDEK_TARIFF_PVZ, packages: body.packages });
          return { pvz, courier: null };
        }
        if (body.tariff_code === CDEK_TARIFF_COURIER) {
          const courier = await client.calculateTariff({ toCityCode: body.to_city_code, tariffCode: CDEK_TARIFF_COURIER, packages: body.packages });
          return { pvz: null, courier };
        }
        const [pvz, courier] = await Promise.all([
          client.calculateTariff({ toCityCode: body.to_city_code, tariffCode: CDEK_TARIFF_PVZ, packages: body.packages }),
          client.calculateTariff({ toCityCode: body.to_city_code, tariffCode: CDEK_TARIFF_COURIER, packages: body.packages }),
        ]);
        return { pvz, courier };
      },
    });

    const configuration = parseCdekEnvironment(process.env);
    if (!configuration.enabled) return res.status(503).json({ message: "Delivery service unavailable" });
    return res.json({
      pvz: tariffs.pvz,
      courier: tariffs.courier,
      customer_cost_pvz: tariffs.pvz ? configuration.options.pvzPriceRub : null,
      customer_cost_courier: tariffs.courier ? configuration.options.courierPriceRub : null,
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
