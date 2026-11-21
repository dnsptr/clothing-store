import { useEffect, useState } from "react";
import { defineWidgetConfig } from "@medusajs/admin-sdk";
import type { AdminOrder, DetailWidgetProps } from "@medusajs/framework/types";
import { Button, Container, Heading, Label } from "@medusajs/ui";
import { sdk } from "../lib/sdk";
import type { HandoffCarrier, HandoffOrigin, HandoffPoint } from "../../lib/carrier-handoff";

type DispatchOptions = {
  carrier: HandoffCarrier | null; location_id?: string; location_name?: string;
  shipping_option_id?: string; points: HandoffPoint[]; default_id: string | null; origin: HandoffOrigin | null;
  shipments: Array<{ id: string; origin: HandoffOrigin | null }>;
};
const OrderDispatchPoint = ({ data: order }: DetailWidgetProps<AdminOrder>) => {
  const [options, setOptions] = useState<DispatchOptions>();
  const [selected, setSelected] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true); setOptions(undefined); setSelected("");
    sdk.client.fetch<DispatchOptions>(`/admin/orders/${order.id}/dispatch-points`).then((result) => {
      if (!active) return;
      setOptions(result); setError("");
      const initial = result.origin?.id ?? result.default_id;
      setSelected(result.points.some((point) => point.id === initial) ? initial ?? "" : "");
    }).catch((e: unknown) => { if (active) setError(e instanceof Error ? e.message : "Не удалось загрузить пункты сдачи"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [order.id, reload]);
  const point = options?.points.find((entry) => entry.id === selected);
  const shipments = options?.shipments ?? [];
  const items = order.items ?? [];
  const hasFulfilled = items.some((item) => Number(item.fulfilled_quantity ?? 0) > 0);
  const canCreate = Boolean(point && options?.location_id && options.shipping_option_id && items.length && !shipments.length && !hasFulfilled && order.payment_status === "captured" && order.status !== "canceled");
  async function create() {
    if (!canCreate || !point || !options) return;
    if (!window.confirm(`Оформить отправление ${options.carrier === "cdek" ? "СДЭК" : "Яндекс"} из пункта «${point.name}», ${point.address}? Будет создана заявка перевозчику; фиксированная плата покупателя не изменится.`)) return;
    setBusy(true); setError("");
    try {
      await sdk.client.fetch(`/admin/orders/${order.id}/fulfillments`, { method: "POST", body: {
        location_id: options.location_id, shipping_option_id: options.shipping_option_id,
        items: items.map((item) => ({ id: item.id, quantity: Number(item.quantity) })),
        additional_data: { dispatch_point_id: point.id },
      } });
      // Reload the native order surface too, so its fulfillment and inventory views agree.
      window.location.reload();
    } catch (e) { setError(e instanceof Error ? e.message : "Не удалось оформить отправление. Проверьте заказ и кабинет перевозчика перед повтором."); setBusy(false); }
  }
  if (!loading && !error && !options?.carrier) return null;
  return <Container className="space-y-4">
    <Heading level="h2">Пункт сдачи перевозчику</Heading>
    {loading && <p role="status">Загрузка пунктов сдачи…</p>}
    {options?.carrier && <>
      <p className="text-ui-fg-subtle text-sm">{options.carrier === "cdek" ? "СДЭК" : "Яндекс"} · Склад: {options.location_name}. Выбор относится к месту сдачи сотрудником, а не к адресу получателя или складу остатков.</p>
      {options.origin && <p className="text-sm">При оформлении заказа: {options.origin.name} — {options.origin.address} ({options.origin.id}).</p>}
      {shipments.map((fulfillment) => {
        const origin = fulfillment.origin;
        return origin ? <p key={fulfillment.id} className="text-sm">Отправление {fulfillment.id}: {origin.name} — {origin.address} ({origin.id}). Пункт зафиксирован.</p> : null;
      })}
      {!shipments.length && <>
        <Label htmlFor={`dispatch-${order.id}`}>Куда сотрудник отвезёт посылки</Label>
        <select id={`dispatch-${order.id}`} value={selected} disabled={busy || loading} className="bg-ui-bg-field border-ui-border-base w-full rounded border p-2 text-sm" onChange={(event) => setSelected(event.target.value)}>
          <option value="">Выберите разрешённый пункт</option>
          {options.points.map((entry) => <option key={entry.id} value={entry.id}>{entry.name} — {entry.address} ({entry.id})</option>)}
        </select>
        {!options.points.length && <p role="alert">Нет активных пунктов сдачи. Настройте их в разделе «Пункты сдачи» для этого склада.</p>}
        {options.origin && !options.points.some((entry) => entry.id === options.origin?.id) && <p role="alert">Исходный пункт отключён или удалён. Автоматическая замена запрещена — выберите другой разрешённый пункт явно.</p>}
        {order.payment_status !== "captured" && <p className="text-ui-fg-subtle text-sm">Отправление доступно после полной подтверждённой оплаты.</p>}
        {hasFulfilled && <p role="alert">В заказе уже есть выполненные позиции. Повторное или частичное оформление этим действием недоступно.</p>}
        <p className="text-ui-fg-subtle text-sm">Перед заявкой проверим пункт и заново рассчитаем расход перевозчика. Цена покупателя не меняется. Каждая упакованная единица останется отдельным местом.</p>
        <Button disabled={!canCreate || loading} isLoading={busy} onClick={() => void create()}>Оформить отправление из выбранного пункта</Button>
      </>}
    </>}
    {error && <div role="alert" className="space-y-2"><p>{error}</p><p className="text-sm">После ошибки оформления сначала проверьте заказ и кабинет перевозчика: не отправляйте заявку повторно вслепую.</p><Button variant="secondary" disabled={busy || loading} onClick={() => setReload((value) => value + 1)}>Обновить доступные пункты</Button></div>}
  </Container>;
};
export const config = defineWidgetConfig({ zone: "order.details.before" });
export default OrderDispatchPoint;
