import { useEffect, useState } from "react"
import { defineRouteConfig } from "@medusajs/admin-sdk"
import { DocumentText } from "@medusajs/icons"
import { Button, Container, Heading, Input, Label, toast } from "@medusajs/ui"
import { sdk } from "../../lib/sdk"
import { ProductEditor } from "../../components/product-editor"
import { normalizeSize } from "../../../lib/catalog-profile"

const CatalogEditorPage = () => {
  const [rows, setRows] = useState<{ id: string; title: string; status: string; missing: string[]; noMeasurements: boolean }[]>([])
  const [filter, setFilter] = useState("all")
  const [loading, setLoading] = useState(false)
  const [q, setQ] = useState("")
  const [selected, setSelected] = useState("")
  const [name, setName] = useState("")
  const [article, setArticle] = useState("")
  const [sku, setSku] = useState("")
  const [color, setColor] = useState("")
  const [size, setSize] = useState("")
  const [price, setPrice] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [offset, setOffset] = useState(0)
  const [count, setCount] = useState(0)
  useEffect(() => {
    let active = true
    setLoading(true); setRows([])
    const timer = window.setTimeout(() => {
      sdk.client.fetch<{ products: typeof rows; count: number }>("/admin/catalog-quality", { query: { q, offset, filter } }).then((data) => {
        if (active) { setRows(data.products); setCount(data.count); setError("") }
      }).catch(() => { if (active) { setError("Не удалось загрузить товары"); setCount(0) } }).finally(() => { if (active) setLoading(false) })
    }, 250)
    return () => { active = false; window.clearTimeout(timer) }
  }, [q, offset, selected, filter])
  async function create() {
    const amount = Number(price.replace(",", "."))
    if (price && (!Number.isFinite(amount) || amount <= 0 || !/^\d+([.,]\d{1,2})?$/.test(price))) { toast.error("Цена должна быть положительной суммой в рублях"); return }
    if ([sku, color, size, price].some(Boolean) && ![sku.trim(), color.trim(), size.trim()].every(Boolean)) { toast.error("Для первого варианта укажите SKU, цвет и размер. Либо оставьте все поля варианта пустыми."); return }
    setBusy(true)
    try {
      const { stores } = await sdk.admin.store.list()
      const channel = stores[0]?.default_sales_channel_id
      const hasVariant = Boolean(sku.trim() && color.trim() && size.trim())
      const normalizedSize = normalizeSize(size)
      const { product } = await sdk.admin.product.create({
        title: name.trim() || "Новый товар", status: "draft",
        metadata: { catalog_profile: { model: article.trim(), brand: "Mario Mikke" } },
        ...(channel ? { sales_channels: [{ id: channel }] } : {}),
        ...(hasVariant ? {
          options: [{ title: "Размер", values: [normalizedSize] }, { title: "Цвет", values: [color.trim()] }],
          variants: [{ title: `${color.trim()} / ${normalizedSize}`, sku: sku.trim(), manage_inventory: true, allow_backorder: false,
            options: { "Размер": normalizedSize, "Цвет": color.trim() }, prices: price ? [{ currency_code: "rub", amount }] : [] }],
        } : { options: [{ title: "Размер", values: [] }, { title: "Цвет", values: [] }], variants: [] }),
      })
      setSelected(product.id); setName(""); setArticle(""); setSku(""); setColor(""); setSize(""); setPrice("")
    } catch (e) { toast.error(e instanceof Error ? e.message : "Не удалось создать черновик") }
    finally { setBusy(false) }
  }
  return <Container className="space-y-6">
    <Heading level="h1">Редактор товаров</Heading>
    {selected ? <><Button variant="secondary" onClick={() => { if (window.confirm("Вернуться к списку? Несохранённые изменения карточки будут потеряны.")) setSelected("") }}>К списку</Button><ProductEditor key={selected} id={selected} /></> : <>
      <div className="grid gap-3 md:grid-cols-2">
        <div><Label htmlFor="new-product-name">Наименование</Label><Input id="new-product-name" value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div><Label htmlFor="new-product-article">Модель / артикул</Label><Input id="new-product-article" value={article} onChange={(e) => setArticle(e.target.value)} /></div>
        <div><Label htmlFor="new-product-sku">SKU первого варианта</Label><Input id="new-product-sku" value={sku} onChange={(e) => setSku(e.target.value)} /></div>
        <div><Label htmlFor="new-product-price">Цена, ₽</Label><Input id="new-product-price" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} /></div>
        <div><Label htmlFor="new-product-color">Цвет</Label><Input id="new-product-color" value={color} onChange={(e) => setColor(e.target.value)} /></div>
        <div><Label htmlFor="new-product-size">Размер</Label><Input id="new-product-size" value={size} onChange={(e) => setSize(e.target.value)} /></div>
      </div><Button disabled={busy} onClick={() => void create()}>Создать черновик</Button>
      <Input aria-label="Поиск товаров" placeholder="Поиск товаров" value={q} onChange={(e) => { setQ(e.target.value); setOffset(0) }} />
      <select aria-label="Заполнение карточек" className="bg-ui-bg-field border-ui-border-base rounded border p-2 text-sm" value={filter} onChange={e => { setFilter(e.target.value); setOffset(0) }}>
        {[["all", "Все товары"], ["incomplete", "Не готовы к публикации"], ["noPhotos", "Без фотографий"], ["noPrice", "Без цены"], ["noComposition", "Без состава"], ["noMeasurements", "Без обмеров"]].map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select>
      {error && <p role="alert">{error}</p>}
      {loading && <p role="status">Загрузка...</p>}
      <ul className="divide-y">{rows.map((product) => <li key={product.id} className="space-y-2 py-3"><div className="flex flex-wrap items-center justify-between gap-3"><button className="min-w-0 break-words text-left underline" onClick={() => setSelected(product.id)}>{product.title}</button><span className="text-ui-fg-subtle text-sm">{product.status === "published" ? "Опубликован" : "Черновик"}</span></div>{product.missing.length ? <details className="text-sm"><summary>Требует заполнения: {product.missing.length}</summary><ul className="list-disc pl-5">{product.missing.map(item => <li key={item}>{item}</li>)}</ul></details> : <p className="text-sm">Обязательные данные заполнены</p>}{product.noMeasurements && <p className="text-ui-fg-subtle text-sm">Обмеры не добавлены</p>}</li>)}</ul>
      <div className="flex flex-wrap items-center gap-3"><Button variant="secondary" disabled={loading || !offset} onClick={() => setOffset(offset - 20)}>Назад</Button><span>{loading ? "Загрузка..." : count ? `${offset + 1}–${Math.min(offset + 20, count)} из ${count}` : "Товаров нет"}</span><Button variant="secondary" disabled={loading || offset + 20 >= count} onClick={() => setOffset(offset + 20)}>Далее</Button></div>
    </>}
  </Container>
}
export const config = defineRouteConfig({ label: "Редактор товаров", icon: DocumentText })
export default CatalogEditorPage
