import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";

import { parseCdekEnvironment } from "../../../../modules/cdek/config";
import { CdekClient } from "../../../../modules/cdek/lib/cdek-client";

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

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const cityCodeStr = req.query.city_code;
  const cityCode = Number(cityCodeStr);

  if (!Number.isInteger(cityCode) || cityCode <= 0) {
    return res.status(400).json({
      message: "city_code parameter must be a positive integer",
      pvz: [],
    });
  }

  const client = getClient();
  if (!client) {
    return res.status(503).json({
      message: "CDEK module is not configured or disabled",
      pvz: [],
    });
  }

  try {
    const pvz = await client.getDeliveryPoints(cityCode);
    res.json({ pvz });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to query CDEK PVZ";
    res.status(500).json({ message, pvz: [] });
  }
}
