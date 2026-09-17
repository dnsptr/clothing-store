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
  const query = String(req.query.query || "").trim();
  if (!query) {
    return res.json({ cities: [] });
  }

  const client = getClient();
  if (!client) {
    return res.status(503).json({
      message: "CDEK module is not configured or disabled",
      cities: [],
    });
  }

  try {
    const cities = await client.searchCities(query, 15);
    res.json({ cities });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to query CDEK cities";
    res.status(500).json({ message, cities: [] });
  }
}
