import { z } from "@medusajs/framework/zod";
import { MedusaError } from "@medusajs/framework/utils";

export const HANDOFF_METADATA_KEY = "carrier_handoff";
export type HandoffCarrier = "cdek" | "yandex";

const pointSchema = z.object({
  id: z.string().trim().min(1).max(255),
  name: z.string().trim().min(1).max(150),
  address: z.string().trim().min(1).max(500),
  active: z.boolean(),
  city_code: z.number().int().positive().optional(),
}).strict();
const groupSchema = z.object({
  default_id: z.string().trim().min(1).max(255).nullable(),
  points: z.array(pointSchema).max(100),
}).strict().superRefine((group, ctx) => {
  const ids = new Set<string>();
  for (const [index, point] of group.points.entries()) {
    if (ids.has(point.id)) ctx.addIssue({ code: "custom", path: ["points", index, "id"], message: "Код пункта повторяется" });
    ids.add(point.id);
  }
  const active = group.points.some((point) => point.active);
  if (active && !group.points.some((point) => point.id === group.default_id && point.active)) {
    ctx.addIssue({ code: "custom", path: ["default_id"], message: "Выберите активный пункт по умолчанию" });
  }
  if (!active && group.default_id !== null) ctx.addIssue({ code: "custom", path: ["default_id"], message: "Без активных пунктов значение по умолчанию должно быть пустым" });
});
export const handoffRegistrySchema = z.object({
  cdek: groupSchema.optional(),
  yandex: groupSchema.optional(),
}).strict().superRefine((registry, ctx) => {
  registry.cdek?.points.forEach((point, index) => {
    if (!point.city_code) ctx.addIssue({ code: "custom", path: ["cdek", "points", index, "city_code"], message: "Для СДЭК нужен код города отправления" });
  });
});
export type HandoffRegistry = z.infer<typeof handoffRegistrySchema>;
export type HandoffPoint = z.infer<typeof pointSchema>;
export type HandoffOrigin = Omit<HandoffPoint, "active"> & { carrier: HandoffCarrier };

export function objectRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

export function readHandoffRegistry(location: unknown): HandoffRegistry {
  const metadata = objectRecord(objectRecord(objectRecord(location).address).metadata);
  const parsed = handoffRegistrySchema.safeParse(metadata[HANDOFF_METADATA_KEY] ?? {});
  if (!parsed.success) throw new MedusaError(MedusaError.Types.INVALID_DATA, "Некорректные настройки пунктов сдачи склада. Исправьте их в разделе «Пункты сдачи».");
  return parsed.data;
}

export function selectHandoffPoint(location: unknown, carrier: HandoffCarrier, requestedId?: unknown): HandoffOrigin {
  const group = readHandoffRegistry(location)[carrier];
  const id = requestedId === undefined ? group?.default_id : requestedId;
  if (typeof id !== "string" || !id.trim()) throw new MedusaError(MedusaError.Types.INVALID_DATA, `Не выбран пункт сдачи ${carrier} для склада отправления.`);
  const point = group?.points.find((candidate) => candidate.id === id && candidate.active);
  if (!point) throw new MedusaError(MedusaError.Types.INVALID_DATA, `Пункт сдачи ${carrier} отключён или отсутствует в разрешённом списке склада.`);
  const { active: _active, ...snapshot } = point;
  return { carrier, ...snapshot };
}

function savedOriginId(data: Record<string, unknown>, carrier: HandoffCarrier): string {
  const origin = objectRecord(data.handoff_origin);
  if (origin.carrier !== carrier || typeof origin.id !== "string" || !origin.id) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "У заказа нет подтверждённого пункта сдачи. Повторите подготовку доставки до оплаты либо явно выберите пункт при оформлении отправления.");
  }
  return origin.id;
}

export function selectCheckoutHandoff(location: unknown, carrier: HandoffCarrier, data: Record<string, unknown> = {}): HandoffOrigin {
  return selectHandoffPoint(location, carrier, data.handoff_origin === undefined ? undefined : savedOriginId(data, carrier));
}

export function selectFulfillmentHandoff(fulfillment: unknown, carrier: HandoffCarrier, data: Record<string, unknown>, additionalData: Record<string, unknown> = {}): HandoffOrigin {
  const location = objectRecord(additionalData.handoff_location);
  const locationId = objectRecord(fulfillment).location_id;
  if (typeof locationId !== "string" || location.id !== locationId) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "Не получен подтверждённый контекст склада отправления. Оформите отправление через административный API с серверной проверкой пунктов.");
  }
  const id = Object.hasOwn(additionalData, "dispatch_point_id") ? additionalData.dispatch_point_id : savedOriginId(data, carrier);
  return selectHandoffPoint(location, carrier, id);
}
