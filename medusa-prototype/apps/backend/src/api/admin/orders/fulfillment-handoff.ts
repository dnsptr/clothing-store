import type { MedusaNextFunction, MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { ContainerRegistrationKeys, MedusaError, Modules } from "@medusajs/framework/utils";
import { HANDOFF_METADATA_KEY, objectRecord, readHandoffRegistry } from "../../../lib/carrier-handoff";
import { CDEK_OPTION_COURIER, CDEK_OPTION_PVZ } from "../../../modules/cdek/provider-id";
import { YANDEX_OPTION_PVZ } from "../../../modules/yandex-delivery/provider-id";

/** Native ORM fulfillment DTOs omit the transient location loaded by the workflow.
 * Supply its fresh registry through native additional_data, never from a client.
 */
export async function withFulfillmentHandoffContext(req: MedusaRequest, _res: MedusaResponse, next: MedusaNextFunction): Promise<void> {
  const body = objectRecord(req.validatedBody ?? req.body);
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);
  const { data: orders } = await query.graph({ entity: "order", filters: { id: req.params.id }, fields: [
    "id", "shipping_methods.shipping_option_id", "shipping_methods.data",
  ] });
  const order = orders[0];
  if (!order) throw new MedusaError(MedusaError.Types.NOT_FOUND, "Заказ не найден");
  const optionId = typeof body.shipping_option_id === "string" ? body.shipping_option_id : order.shipping_methods?.[0]?.shipping_option_id;
  const method = order.shipping_methods?.find((entry) => entry?.shipping_option_id === optionId);
  const mode = objectRecord(method?.data).delivery_mode;
  if (mode !== CDEK_OPTION_PVZ && mode !== CDEK_OPTION_COURIER && mode !== YANDEX_OPTION_PVZ) {
    next(); return;
  }
  let locationId = typeof body.location_id === "string" ? body.location_id : undefined;
  if (!locationId) {
    if (!optionId) throw new MedusaError(MedusaError.Types.INVALID_DATA, "Не найден способ доставки заказа");
    const { data: options } = await query.graph({ entity: "shipping_option", filters: { id: optionId }, fields: [
      "id", "service_zone.fulfillment_set.location.id",
    ] });
    locationId = options[0]?.service_zone?.fulfillment_set?.location?.id;
  }
  if (!locationId) throw new MedusaError(MedusaError.Types.INVALID_DATA, "Не найден склад отправления");
  const service = req.scope.resolve(Modules.STOCK_LOCATION);
  const location = await service.retrieveStockLocation(locationId, { relations: ["address"] });
  const additionalData = {
    ...objectRecord(body.additional_data),
    handoff_location: { id: location.id, address: { metadata: { [HANDOFF_METADATA_KEY]: readHandoffRegistry(location) } } },
  };
  req.body = { ...objectRecord(req.body), additional_data: additionalData };
  if (req.validatedBody !== undefined) req.validatedBody = { ...body, additional_data: additionalData };
  next();
}
