import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils";
import { objectRecord, readHandoffRegistry, type HandoffCarrier } from "../../../../../lib/carrier-handoff";
import { CDEK_OPTION_COURIER, CDEK_OPTION_PVZ } from "../../../../../modules/cdek/provider-id";
import { YANDEX_OPTION_PVZ } from "../../../../../modules/yandex-delivery/provider-id";

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);
  const { data: orders } = await query.graph({ entity: "order", filters: { id: req.params.id }, fields: [
    "id", "shipping_methods.id", "shipping_methods.shipping_option_id", "shipping_methods.data",
    "fulfillments.id", "fulfillments.data", "fulfillments.canceled_at",
  ] });
  const order = orders[0];
  if (!order) throw new MedusaError(MedusaError.Types.NOT_FOUND, "Заказ не найден");
  const method = order.shipping_methods?.[0];
  const data = objectRecord(method?.data);
  const mode = data.delivery_mode;
  const carrier: HandoffCarrier | undefined = mode === CDEK_OPTION_PVZ || mode === CDEK_OPTION_COURIER ? "cdek"
    : mode === YANDEX_OPTION_PVZ ? "yandex" : undefined;
  const shipments = (order.fulfillments ?? []).filter((fulfillment): fulfillment is NonNullable<typeof fulfillment> => fulfillment != null && !fulfillment.canceled_at)
    .map((fulfillment) => ({ id: fulfillment.id, origin: objectRecord(fulfillment.data).handoff_origin ?? null }));
  if (!carrier || !method?.shipping_option_id) {
    res.json({ carrier: null, points: [], default_id: null, origin: null, shipments });
    return;
  }
  const { data: options } = await query.graph({ entity: "shipping_option", filters: { id: method.shipping_option_id }, fields: [
    "id", "service_zone.fulfillment_set.location.id", "service_zone.fulfillment_set.location.name",
    "service_zone.fulfillment_set.location.address.*",
  ] });
  const location = options[0]?.service_zone?.fulfillment_set?.location;
  if (!location) throw new MedusaError(MedusaError.Types.INVALID_DATA, "Способ доставки не привязан к складу отправления");
  const group = readHandoffRegistry(location)[carrier];
  res.json({ carrier, location_id: location.id, location_name: location.name,
    shipping_option_id: method.shipping_option_id,
    points: group?.points.filter((point) => point.active) ?? [],
    default_id: group?.default_id ?? null, origin: data.handoff_origin ?? null,
    shipments,
  });
}
