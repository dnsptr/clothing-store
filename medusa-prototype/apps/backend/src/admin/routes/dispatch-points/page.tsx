import { useEffect, useState } from "react";
import { defineRouteConfig } from "@medusajs/admin-sdk";
import { MapPin } from "@medusajs/icons";
import { Button, Container, Heading, Input, Label, toast } from "@medusajs/ui";
import { sdk } from "../../lib/sdk";
import type { HandoffCarrier, HandoffPoint, HandoffRegistry } from "../../../lib/carrier-handoff";

type Location = { id: string; name: string; has_address: boolean; registry: HandoffRegistry };
const carriers: { id: HandoffCarrier; name: string }[] = [{ id: "cdek", name: "СДЭК" }, { id: "yandex", name: "Яндекс" }];
const emptyGroup = () => ({ default_id: null, points: [] as HandoffPoint[] });

const DispatchPointsPage = () => {
  const [locations, setLocations] = useState<Location[]>([]);
  const [selected, setSelected] = useState("");
  const [registry, setRegistry] = useState<HandoffRegistry>({});
  const [offset, setOffset] = useState(0);
  const [count, setCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true);
    sdk.client.fetch<{ locations: Location[]; count: number }>("/admin/dispatch-points", { query: { offset } })
      .then((result) => {
        if (!active) return;
        setLocations(result.locations); setCount(result.count);
        const first = result.locations[0];
        setSelected(first?.id ?? ""); setRegistry(first?.registry ?? {}); setDirty(false); setError("");
      }).catch((e: unknown) => { if (active) setError(e instanceof Error ? e.message : "Не удалось загрузить склады"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [offset, reload]);
  function mayLeave() { return !dirty || window.confirm("Отменить несохранённые изменения пунктов сдачи?"); }
  function changeGroup(carrier: HandoffCarrier, update: Partial<NonNullable<HandoffRegistry[HandoffCarrier]>>) {
    setRegistry((current) => ({ ...current, [carrier]: { ...(current[carrier] ?? emptyGroup()), ...update } }));
    setDirty(true);
  }
  function changePoint(carrier: HandoffCarrier, index: number, update: Partial<HandoffPoint>) {
    const group = registry[carrier] ?? emptyGroup();
    const previous = group.points[index];
    const points = group.points.map((point, i) => i === index ? { ...point, ...update } : point);
    let defaultId = group.default_id;
    if (previous?.id === defaultId && update.id !== undefined) defaultId = update.id || null;
    if (previous?.id === defaultId && update.active === false) defaultId = points.find((point) => point.active)?.id || null;
    changeGroup(carrier, { points, default_id: defaultId });
  }
  async function save() {
    setBusy(true); setError("");
    try {
      const result = await sdk.client.fetch<{ location: Pick<Location, "id" | "registry"> }>(`/admin/dispatch-points/${selected}`, { method: "POST", body: { registry } });
      setRegistry(result.location.registry);
      setLocations((current) => current.map((location) => location.id === selected ? { ...location, registry: result.location.registry } : location));
      setDirty(false); toast.success("Пункты сдачи сохранены");
    } catch (e) { setError(e instanceof Error ? e.message : "Не удалось сохранить пункты сдачи"); }
    finally { setBusy(false); }
  }
  const location = locations.find((entry) => entry.id === selected);
  return <Container className="space-y-6">
    <Heading level="h1">Пункты сдачи перевозчикам</Heading>
    <p className="text-ui-fg-subtle text-sm">Это места, куда сотрудники отвозят посылки. Остатки остаются на штатном складе Medusa; ПВЗ покупателя выбирается отдельно. Укажите только подтверждённые пункты приёма по вашему договору.</p>
    {loading ? <p role="status">Загрузка складов…</p> : <>
      <Label htmlFor="handoff-location">Склад отправления</Label>
      <select id="handoff-location" className="bg-ui-bg-field border-ui-border-base w-full rounded border p-2 text-sm" value={selected} disabled={busy} onChange={(event) => {
        if (!mayLeave()) return;
        const next = locations.find((entry) => entry.id === event.target.value);
        setSelected(next?.id ?? ""); setRegistry(next?.registry ?? {}); setDirty(false); setError("");
      }}>{locations.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select>
      {!locations.length && <p>Сначала создайте склад и его адрес в штатных настройках Medusa.</p>}
      {location && !location.has_address && <p role="alert">Сначала заполните адрес выбранного склада в штатных настройках Medusa.</p>}
      <fieldset disabled={busy || !location?.has_address} className="space-y-6">
        {carriers.map(({ id: carrier, name }) => {
          const group = registry[carrier] ?? emptyGroup();
          return <section key={carrier} className="space-y-4 border-t pt-4">
            <Heading level="h2">{name}</Heading>
            <Label htmlFor={`${carrier}-default`}>Пункт по умолчанию для новых заказов</Label>
            <select id={`${carrier}-default`} className="bg-ui-bg-field border-ui-border-base w-full rounded border p-2 text-sm" value={group.default_id ?? ""} onChange={(e) => changeGroup(carrier, { default_id: e.target.value || null })}>
              <option value="">Не выбран</option>
              {group.points.filter((point) => point.active && point.id).map((point, index) => <option key={index} value={point.id}>{point.name || point.id} — {point.address}</option>)}
            </select>
            {!group.points.length && <p className="text-ui-fg-subtle text-sm">Пункты не настроены — этот перевозчик не готов к оплате и отправке.</p>}
            {group.points.map((point, index) => <div key={index} className="space-y-3 rounded border p-4">
              <div className="grid gap-3 md:grid-cols-2">
                <div><Label htmlFor={`${carrier}-${index}-id`}>{carrier === "cdek" ? "Код ПВЗ СДЭК" : "ID приёмной станции Яндекса"}</Label><Input id={`${carrier}-${index}-id`} value={point.id} onChange={(e) => changePoint(carrier, index, { id: e.target.value })} maxLength={255} /></div>
                <div><Label htmlFor={`${carrier}-${index}-name`}>Название для сотрудников</Label><Input id={`${carrier}-${index}-name`} value={point.name} onChange={(e) => changePoint(carrier, index, { name: e.target.value })} maxLength={150} /></div>
                <div><Label htmlFor={`${carrier}-${index}-address`}>Фактический адрес сдачи</Label><Input id={`${carrier}-${index}-address`} value={point.address} onChange={(e) => changePoint(carrier, index, { address: e.target.value })} maxLength={500} /></div>
                {carrier === "cdek" && <div><Label htmlFor={`${carrier}-${index}-city`}>Код города СДЭК</Label><Input id={`${carrier}-${index}-city`} type="number" min={1} step={1} value={point.city_code ?? ""} onChange={(e) => changePoint(carrier, index, { city_code: e.target.value ? Number(e.target.value) : undefined })} /></div>}
              </div>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={point.active} onChange={(e) => changePoint(carrier, index, { active: e.target.checked })} />Разрешён для новых отправлений</label>
              <Button variant="danger" size="small" onClick={() => {
                const points = group.points.filter((_, i) => i !== index);
                changeGroup(carrier, { points, default_id: group.default_id === point.id ? points.find((entry) => entry.active)?.id || null : group.default_id });
              }}>Удалить пункт</Button>
            </div>)}
            <Button variant="secondary" size="small" disabled={group.points.length >= 100} onClick={() => changeGroup(carrier, { points: [...group.points, { id: "", name: "", address: "", active: true }] })}>Добавить пункт {name}</Button>
          </section>;
        })}
        <p className="text-ui-fg-subtle text-sm">Изменение пункта по умолчанию не перенаправляет существующие заказы. Для них сотрудник явно выбирает другой разрешённый пункт при оформлении. Отключение пункта блокирует его дальнейшее использование, но не меняет уже созданные отправления.</p>
        <Button disabled={!dirty || !selected} isLoading={busy} onClick={() => void save()}>Сохранить пункты сдачи</Button>
      </fieldset>
      <div className="flex items-center gap-3"><Button variant="secondary" disabled={busy || !offset} onClick={() => { if (mayLeave()) setOffset(offset - 50); }}>Назад</Button><span>{count ? `${offset + 1}–${Math.min(offset + 50, count)} из ${count}` : "Складов нет"}</span><Button variant="secondary" disabled={busy || offset + 50 >= count} onClick={() => { if (mayLeave()) setOffset(offset + 50); }}>Далее</Button></div>
    </>}
    {error && <div role="alert" className="space-y-2"><p>{error}</p><Button variant="secondary" disabled={busy || loading} onClick={() => { if (mayLeave()) setReload((value) => value + 1); }}>Повторить загрузку</Button></div>}
  </Container>;
};
export const config = defineRouteConfig({ label: "Пункты сдачи", icon: MapPin });
export default DispatchPointsPage;
