import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { Badge, Button, Heading, Label, Tabs } from "@medusajs/ui"
import { sdk } from "../lib/sdk"
import type { buildPreview } from "../../lib/onec/preview"
import type { scopeCatalog } from "../../lib/onec/scope"
import type { warehousePolicy } from "../../lib/onec/warehouses"

type Report = ReturnType<typeof buildPreview> & { warehousePolicy?: ReturnType<typeof warehousePolicy>; scope?: ReturnType<typeof scopeCatalog>["scope"]; builtAt?: string; sources: { catalog: { sha256: string }; offers: { sha256: string } } }
type Session = { id: string; createdAt: string; files: { name: string; status: string; summary?: { products: number; offers: number } }[] }
const statusLabels = { linked: "Связь по ID", candidate: "Кандидат", ambiguous: "Неоднозначно", missing: "Не найден", parent: "Родительская запись" }
const warningLabels: Record<string, string> = {
  warehouse_allowlist_not_confirmed: "Разрешённые склады не подтверждены. Остаток к применению не рассчитывается.",
  quantity_semantics_not_confirmed: "Нужно подтвердить, что именно передаёт количество 1С и как учитываются резервы.",
  duplicate_warehouse_definitions: "Обнаружены повторяющиеся или пустые идентификаторы складов.",
  price_type_not_unique: "Нельзя однозначно выбрать тип цены.",
  invalid_quantity: "Некорректное количество", negative_quantity: "Есть отрицательные остатки", unknown_or_duplicate_warehouse: "Неизвестный или неоднозначный склад",
  duplicate_stock_row: "Склад повторяется в остатках предложения", invalid_offer_id: "Некорректный идентификатор предложения", duplicate_offer_id: "Идентификатор предложения повторяется",
  parent_offer: "Предложение без характеристики не сопоставляется автоматически", product_not_in_catalog: "Товар отсутствует в выбранном файле каталога",
  product_not_unique: "Не найден единственный товар сайта", duplicate_binding: "Несколько вариантов связаны с одним ID 1С", missing_dimensions: "Цвет или размер не определены однозначно",
  similar_source_characteristics: "Похожие характеристики 1С с разными ID. Автообъединение запрещено", binding_not_confirmed: "Связь по цвету и размеру требует подтверждения",
  duplicate_store_variants: "На сайте несколько подходящих вариантов", variant_not_found: "На сайте нет подходящего варианта", price_not_unique_or_unsupported: "Цена отсутствует, неоднозначна или не поддерживается",
  store_price_not_unique: "Базовая рублёвая цена сайта не определена однозначно", target_claimed_twice: "Несколько предложений претендуют на один вариант сайта",
  bound_dimensions_differ: "Сохранённый ID указывает на вариант с другим цветом или размером",
}
const money = (amount: number | null) => amount === null ? "—" : new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: 2 }).format(amount)

export function OnecPreview({ sessions }: { sessions: Session[] }) {
  const files = sessions.flatMap(session => session.files.filter(file => file.status === "validated").map(file => ({ ...file, sessionId: session.id, key: session.id + "/" + file.name, date: session.createdAt })))
  const catalogs = files.filter(file => (file.summary?.products ?? 0) > 0)
  const offers = files.filter(file => (file.summary?.offers ?? 0) > 0)
  const [catalogKey, setCatalogKey] = useState("")
  const [offersKey, setOffersKey] = useState("")
  const [report, setReport] = useState<Report | null>(null)
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const [request, setRequest] = useState<{ catalog: { sessionId: string; name: string }; offers: { sessionId: string; name: string } } | null>(null)
  const effectiveCatalog = catalogKey || catalogs[0]?.key || ""
  const effectiveOffers = offersKey || offers[0]?.key || ""
  const signature = effectiveCatalog + "|" + effectiveOffers
  useEffect(() => { setRequest(null); setReport(null); setError(""); setBusy(false) }, [signature])
  useEffect(() => {
    if (!request) return
    let active = true
    setBusy(true); setError(""); setReport(null)
    const catalog = request.catalog
    const offer = request.offers
    sdk.client.fetch<Report>("/admin/onec-exchange/preview", { query: { catalog_session: catalog.sessionId, catalog_file: catalog.name, offers_session: offer.sessionId, offers_file: offer.name } }).then(data => { if (active) setReport(data) }).catch(error => { if (active) setError(error instanceof Error ? error.message : "Не удалось построить отчёт") }).finally(() => { if (active) setBusy(false) })
    return () => { active = false }
  }, [request])
  function select(set: (value: string) => void, value: string) { set(value); setRequest(null); setReport(null); setError(""); setBusy(false) }
  function build() {
    const catalog = catalogs.find(file => file.key === effectiveCatalog)
    const offer = offers.find(file => file.key === effectiveOffers)
    if (!catalog || !offer) { setError("Выбранные файлы больше недоступны. Обновите журнал."); return }
    setCatalogKey(catalog.key); setOffersKey(offer.key)
    setRequest({ catalog, offers: offer })
  }
  return <section className="space-y-5 border-b border-ui-border-base px-6 py-5">
    <div className="flex flex-wrap items-center gap-3"><Heading level="h2">Предварительное сопоставление</Heading><Badge color="grey">Без сохранения связей</Badge></div>
    <div className="grid gap-4 lg:grid-cols-2">
      {([{ label: "Файл каталога", id: "onec-preview-catalog", value: effectiveCatalog, items: catalogs, set: setCatalogKey }, { label: "Файл предложений", id: "onec-preview-offers", value: effectiveOffers, items: offers, set: setOffersKey }]).map(field => <div key={field.id} className="min-w-0 space-y-2"><Label htmlFor={field.id}>{field.label}</Label><select id={field.id} className="w-full min-w-0 rounded border border-ui-border-base bg-ui-bg-field p-2 text-sm" value={field.value} onChange={event => select(field.set, event.target.value)}><option value="">Выберите файл</option>{field.items.map(file => <option key={file.key} value={file.key}>{new Date(file.date).toLocaleString("ru-RU")} · {file.name} · {file.sessionId.slice(0, 8)}</option>)}</select></div>)}
    </div>
    <Button variant="secondary" disabled={busy || !effectiveCatalog || !effectiveOffers} onClick={build}>Построить отчёт</Button>
    {busy && <p role="status" className="text-sm">Построение отчёта...</p>}
    {error && <p role="alert" className="break-words text-sm text-ui-fg-error">{error}</p>}
    {!effectiveCatalog || !effectiveOffers ? <p className="text-sm text-ui-fg-subtle">Нужны проверенные файлы каталога и предложений одного обмена.</p> : null}
    {report && <>
      <p className="text-sm">Товары, цены, остатки и связи не изменены. Кандидат — не подтверждённая связь.</p>
      {report.scope && <div className="space-y-2 border-l-2 border-ui-border-strong pl-3 text-sm">
        <p>Источник цен и наличия: 1С. Получено артикулов: {report.scope.receivedArticles.length} из {report.scope.expectedArticles.length}.</p>
        {report.scope.missingArticles.length > 0 && <p className="break-words">Не получены: {report.scope.missingArticles.join(", ")}</p>}
        {(report.scope.excludedProducts > 0 || report.scope.excludedOffers > 0) && <p>Вне ассортимента: товаров {report.scope.excludedProducts}, предложений {report.scope.excludedOffers}. Они исключены из сопоставления.</p>}
      </div>}
      {report.warehousePolicy && <div className="space-y-2 text-sm"><p>Характеристики с разными ID не объединяются. Запись остатков выключена.</p>{report.warehousePolicy.targets.map(target => <p key={target.key}>{target.name} ({target.postalCode}): {target.matched ? `найден склад «${target.sourceName}»` : "нужно сопоставить со складом 1С"}</p>)}</div>}
      {report.builtAt && <p className="text-xs text-ui-fg-subtle">Сформирован: {new Date(report.builtAt).toLocaleString("ru-RU")}</p>}
      <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm"><span>Кандидаты: {report.summary.candidates}</span><span>Связи по ID: {report.summary.linked}</span><span>Неоднозначно: {report.summary.ambiguous}</span><span>Не найдены: {report.summary.missing}</span><span>Родительские: {report.summary.parent}</span><span>Различия цен: {report.summary.priceDifferences}</span></div>
      {report.products.map(product => <div key={product.source.id} className="space-y-1 text-sm"><p>{product.source.article} · {product.source.name}</p><p className="break-all text-ui-fg-subtle">ID 1С: {product.source.id}</p>{product.candidates.map(candidate => <p key={candidate.id}><Link to={`/products/${candidate.id}`} className="text-ui-fg-interactive underline">{candidate.title}</Link> · вариантов: {candidate.variantCount}</p>)}</div>)}
      <p className="text-sm text-ui-fg-subtle">Тип цены: {report.priceType?.name || "Не определён"}. Остаток к применению: не рассчитан.</p>
      <Tabs defaultValue="variants">
        <div className="overflow-x-auto"><Tabs.List className="min-w-max"><Tabs.Trigger value="variants">Предложения ({report.rows.length})</Tabs.Trigger><Tabs.Trigger value="warehouses">Склады ({report.warehouses.length})</Tabs.Trigger><Tabs.Trigger value="warnings">Предупреждения</Tabs.Trigger></Tabs.List></div>
        <Tabs.Content value="variants" className="overflow-x-auto">
          <table className="w-full min-w-[850px] text-left text-sm"><thead className="text-ui-fg-subtle"><tr>{["Характеристика 1С", "Вариант сайта", "Сопоставление", "Цена 1С / сайт", "Детали"].map(label => <th key={label} className="p-3 font-medium">{label}</th>)}</tr></thead><tbody>{report.rows.map((row, index) => <tr key={row.sourceOfferId + index} className="border-t border-ui-border-base align-top">
            <td className="max-w-[220px] p-3">{row.color || "Без цвета"} / {row.size || "Без размера"}</td><td className="max-w-[220px] p-3">{row.target?.title || "—"}{row.target && <p className="mt-1 break-all text-xs text-ui-fg-subtle">{row.target.sku}</p>}{!row.target && row.suggestions.map(suggestion => <p key={suggestion.variantId} className="mt-2 text-xs text-ui-fg-subtle">Возможный: {suggestion.title} · {suggestion.sku}</p>)}</td><td className="p-3">{statusLabels[row.status]}</td><td className="p-3">{money(row.price.incoming)} / {money(row.price.current)}<p className="mt-1 text-xs text-ui-fg-subtle">{row.price.changed === null ? "Сравнение недоступно" : row.price.changed ? "Есть различие" : "Без изменения"}</p></td>
            <td className="max-w-[420px] p-3"><details><summary className="cursor-pointer">{row.warnings.length ? `Проверить (${row.warnings.length})` : "Посмотреть"}</summary><div className="mt-3 space-y-3"><p className="break-all">ID предложения: {row.sourceOfferId}</p><p>Количество 1С: {row.reportedQuantity || "Не передано"}</p><ul className="list-disc space-y-1 pl-4">{row.warnings.map(warning => <li key={warning}>{warningLabels[warning] || warning}</li>)}</ul><ul className="space-y-1">{row.stocks.map((stock, i) => <li key={stock.warehouseId + i}>{stock.warehouseName}: {stock.quantity}</li>)}</ul></div></details></td>
          </tr>)}</tbody></table>
        </Tabs.Content>
        <Tabs.Content value="warehouses" className="overflow-x-auto"><table className="w-full min-w-[600px] text-left text-sm"><thead><tr>{["Склад 1С", "Идентификатор", "Допуск к продажам"].map(label => <th key={label} className="p-3 font-medium">{label}</th>)}</tr></thead><tbody>{report.warehouses.map((warehouse, index) => <tr key={warehouse.id + index} className="border-t border-ui-border-base"><td className="p-3">{warehouse.name}</td><td className="p-3 font-mono text-xs">{warehouse.id}</td><td className="p-3">Не подтверждён</td></tr>)}</tbody></table></Tabs.Content>
        <Tabs.Content value="warnings"><ul className="list-disc space-y-2 py-4 pl-5 text-sm">{report.warnings.map(warning => <li key={warning}>{warningLabels[warning] || warning}</li>)}</ul></Tabs.Content>
      </Tabs>
    </>}
  </section>
}
