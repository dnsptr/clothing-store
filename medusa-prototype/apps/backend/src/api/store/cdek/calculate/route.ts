import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";

import { parseCdekEnvironment } from "../../../../modules/cdek/config";
import { CdekClient } from "../../../../modules/cdek/lib/cdek-client";
import { CDEK_TARIFF_COURIER, CDEK_TARIFF_PVZ } from "../../../../modules/cdek/provider-id";

let cdekClientInstance: CdekClient | null = null;

function getClient(): CdekClient | null {
  if (!cdekClientInstance) {
    const config = parseCdekEnvironment(process.env);
    if (config.enabled) {
      cdekClientInstance = new CdekClient(config.options);
    }
  }
  return cdekClientInstance;
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const body = (req.body || {}) as {
    to_city_code?: number;
    tariff_code?: number;
    weight?: number;
  };

  const toCityCode = Number(body.to_city_code);
  if (!Number.isInteger(toCityCode) || toCityCode <= 0) {
    return res.status(400).json({
      message: "to_city_code must be a positive integer",
    });
  }

  const client = getClient();
  if (!client) {
    return res.status(503).json({
      message: "CDEK module is not configured or disabled",
    });
  }

  const tariffCode = body.tariff_code || CDEK_TARIFF_PVZ;
  const weight = typeof body.weight === "number" && body.weight > 0 ? body.weight : 1000;

  try {
    const [pvzTariff, courierTariff] = await Promise.allSettled([
      client.calculateTariff({ toCityCode, tariffCode: CDEK_TARIFF_PVZ, packages: [{ weight }] }),
      client.calculateTariff({ toCityCode, tariffCode: CDEK_TARIFF_COURIER, packages: [{ weight }] }),
    ]);

    res.json({
      pvz: pvzTariff.status === "fulfilled" ? pvzTariff.value : null,
      courier: courierTariff.status === "fulfilled" ? courierTariff.value : null,
      // Launch policy: 0 RUB for customer
      customer_cost: 0,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Calculation failed";
    res.status(500).json({ message });
  }
}
