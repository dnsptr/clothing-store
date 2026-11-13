import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { MedusaError, Modules } from "@medusajs/framework/utils";
import { updateStockLocationsWorkflow } from "@medusajs/medusa/core-flows";
import { HANDOFF_METADATA_KEY } from "../../../../lib/carrier-handoff";
import type { UpdateHandoffRegistry } from "../validators";

export async function POST(req: MedusaRequest<UpdateHandoffRegistry>, res: MedusaResponse) {
  const service = req.scope.resolve(Modules.STOCK_LOCATION);
  const location = await service.retrieveStockLocation(req.params.id, { relations: ["address"] });
  const address = location.address;
  if (!address) throw new MedusaError(MedusaError.Types.INVALID_DATA, "Сначала заполните адрес склада в штатных настройках Medusa.");
  await updateStockLocationsWorkflow(req.scope).run({ input: {
    selector: { id: location.id },
    update: { address: {
      address_1: address.address_1, address_2: address.address_2,
      country_code: address.country_code, city: address.city, province: address.province,
      postal_code: address.postal_code, phone: address.phone,
      metadata: { ...address.metadata, [HANDOFF_METADATA_KEY]: req.validatedBody.registry },
    } },
  } });
  res.json({ location: { id: location.id, name: location.name, registry: req.validatedBody.registry } });
}
