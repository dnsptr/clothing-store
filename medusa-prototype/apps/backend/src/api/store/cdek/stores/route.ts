import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";

import { MOSCOW_PICKUP_STORES } from "../../../../modules/cdek/service";

export async function GET(_req: MedusaRequest, res: MedusaResponse) {
  res.json({
    stores: MOSCOW_PICKUP_STORES,
  });
}
