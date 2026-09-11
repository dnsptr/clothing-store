import { useEffect, useState } from "react"
import { defineRouteConfig } from "@medusajs/admin-sdk"
import { DocumentText } from "@medusajs/icons"
import { Button, Container, Heading, Input, Label, toast } from "@medusajs/ui"
import { sdk } from "../../lib/sdk"
import { ProductEditor } from "../../components/product-editor"
import { normalizeSize } from "../../../lib/catalog-profile"

const CatalogEditorPage = () => {
  const [rows, setRows] = useState<{ id: string; title: string; status: string }[]>([])
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
    const timer = window.setTimeout(() => {
      sdk.admin.product.list({ q, limit: 20, offset, order: "-created_at" }).then((data) => {
        if (active) { setRows(data.products); setCount(data.count); setError("") }
      }).catch(() => { if (active) setError("Не удалось загрузить товары") })
    }, 250)
    return () => { active = false; window.clearTimeout(timer) }
  }, [q, offset, selected])
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
        } : {}),
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
      {error && <p role="alert">{error}</p>}
      <ul className="divide-y">{rows.map((product) => <li key={product.id} className="flex items-center justify-between gap-3 py-3"><button className="text-left underline" onClick={() => setSelected(product.id)}>{product.title}</button><span className="text-ui-fg-subtle text-sm">{product.status === "published" ? "Опубликован" : "Черновик"}</span></li>)}</ul>
      <div className="flex items-center gap-3"><Button variant="secondary" disabled={!offset} onClick={() => setOffset(offset - 20)}>Назад</Button><span>{count ? `${offset + 1}–${Math.min(offset + 20, count)} из ${count}` : "Товаров нет"}</span><Button variant="secondary" disabled={offset + 20 >= count} onClick={() => setOffset(offset + 20)}>Далее</Button></div>
    </>}
  </Container>
}
export const config = defineRouteConfig({ label: "Редактор товаров", icon: DocumentText })
export default CatalogEditorPage
