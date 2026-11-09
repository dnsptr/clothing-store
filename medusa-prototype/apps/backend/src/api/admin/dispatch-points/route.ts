import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { Modules } from "@medusajs/framework/utils";
import { readHandoffRegistry } from "../../../lib/carrier-handoff";

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const offset = Number(req.query.offset ?? 0);
  if (!Number.isSafeInteger(offset) || offset < 0) {
    res.status(400).json({ message: "Некорректное смещение списка складов" });
    return;
  }
  const service = req.scope.resolve(Modules.STOCK_LOCATION);
  const [locations, count] = await service.listAndCountStockLocations({}, {
    relations: ["address"], skip: offset, take: 50,
    order: { name: "ASC", id: "ASC" },
  });
  res.json({ locations: locations.map((location) => ({
    id: location.id, name: location.name, has_address: Boolean(location.address),
    registry: readHandoffRegistry(location),
  })), count });
}
