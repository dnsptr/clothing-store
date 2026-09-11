import { useCallback, useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { ArrowUpMini, ArrowDownMini, Trash } from "@medusajs/icons"
import { Badge, Button, Heading, Input, Label, Textarea, toast } from "@medusajs/ui"
import { sdk } from "../lib/sdk"
import { resolveMediaPreviewUrl } from "../lib/media"
import { PROFILE_FIELDS, profileProblems, readProfile, type CatalogProfile } from "../../lib/catalog-profile"

interface ProductRow {
  id: string; title: string; description?: string | null; status: string; updated_at: string
  metadata?: Record<string, unknown>; thumbnail?: string | null
  images: { id: string; url: string }[]
  categories?: { id: string; name: string }[]; collection_id?: string | null
  variants?: { id: string; title: string; sku?: string; prices?: { currency_code: string; amount: number }[] }[]
}
type LabelImage = { name: string; url: string }
const tabs = ["Карточка", "Варианты и цены", "Фотографии", "Каталог", "Метрики"]

export const ProductEditor = ({ id }: { id: string }) => {
  const [product, setProduct] = useState<ProductRow | null>(null)
  const [profile, setProfile] = useState<CatalogProfile>(readProfile(null))
  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")
  const [images, setImages] = useState<string[]>([])
  const [labels, setLabels] = useState<LabelImage[]>([])
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([])
  const [collections, setCollections] = useState<{ id: string; title: string }[]>([])
  const [categoryIds, setCategoryIds] = useState<string[]>([])
  const [collectionId, setCollectionId] = useState("")
  const [storefront, setStorefront] = useState("")
  const [tab, setTab] = useState(tabs[0])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [dirty, setDirty] = useState(false)

  const load = useCallback(async () => {
    setError("")
    try {
      const data = await sdk.client.fetch<{ product: ProductRow }>(`/admin/products/${id}`, {
        query: { fields: "*variants,*variants.prices,*categories,*images,+metadata" },
      })
      const p = data.product
      setProduct(p); setTitle(p.title); setDescription(p.description ?? "")
      setProfile(readProfile(p.metadata?.catalog_profile))
      setImages([...(p.thumbnail ? [p.thumbnail] : []), ...p.images.map((image) => image.url)].filter((url, i, all) => all.indexOf(url) === i))
      setCategoryIds(p.categories?.map((category) => category.id) ?? [])
      setCollectionId(p.collection_id ?? ""); setDirty(false)
      const stored = p.metadata?.catalog_profile as { label_images?: LabelImage[] } | undefined
      setLabels(Array.isArray(stored?.label_images) ? stored.label_images.filter((image) => image && typeof image.url === "string" && typeof image.name === "string") : [])
      const cats = await sdk.client.fetch<{ product_categories: { id: string; name: string }[] }>("/admin/product-categories", { query: { limit: 1000 } })
      const cols = await sdk.client.fetch<{ collections: { id: string; title: string }[] }>("/admin/collections", { query: { limit: 1000 } })
      setCategories(cats.product_categories); setCollections(cols.collections)
      const content = await sdk.client.fetch<{ storefront_url: string }>("/admin/content/slides", { query: { section: "promo" } })
      setStorefront(content.storefront_url)
    } catch (e) { setError(e instanceof Error ? e.message : "Не удалось загрузить карточку") }
  }, [id])

  useEffect(() => { void load() }, [load])
  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault() }
    window.addEventListener("beforeunload", warn)
    return () => window.removeEventListener("beforeunload", warn)
  }, [dirty])

  const change = (key: keyof CatalogProfile, value: string | boolean) => {
    setProfile((previous) => ({ ...previous, [key]: value })); setDirty(true)
  }
  const missing = [
    ...(!title.trim() ? ["Наименование"] : []), ...profileProblems(profile),
    ...(!images.length ? ["Фото товара"] : []), ...(!categoryIds.length ? ["Категория"] : []),
    ...(!product?.variants?.length ? ["Варианты, размеры и цены"] : []),
    ...(product?.variants?.some((variant) => !variant.prices?.some((price) => price.currency_code === "rub" && price.amount > 0)) ? ["Рублёвая цена для каждого варианта"] : []),
  ]

  async function save(status: "draft" | "published") {
    if (!product) return
    if (status === "published" && missing.length) { toast.error("Заполните карточку перед публикацией"); return }
    setBusy(true)
    try {
      const { product: current } = await sdk.client.fetch<{ product: ProductRow }>(`/admin/products/${id}`)
      if (current.updated_at !== product.updated_at) throw new Error("Товар изменён другим сотрудником. Обновите страницу и проверьте изменения.")
      await sdk.admin.product.update(id, {
        title: title.trim() || product.title, description, status,
        metadata: { ...current.metadata, catalog_profile: { ...profile, label_images: labels } },
        images: images.map((url) => ({ url })), thumbnail: images[0] ?? null,
        categories: categoryIds.map((categoryId) => ({ id: categoryId })), collection_id: collectionId || null,
      })
      toast.success(status === "draft" ? "Черновик сохранён" : "Товар опубликован")
      await load()
    } catch (e) { toast.error(e instanceof Error ? e.message : "Не удалось сохранить") }
    finally { setBusy(false) }
  }

  async function upload(files: FileList | null, internal: boolean) {
    if (!files?.length) return
    const picked = Array.from(files)
    const limit = 10 * 1024 * 1024
    if (picked.some((file) => !["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > limit)) {
      toast.error("JPEG, PNG или WebP, до 10 МБ на файл"); return
    }
    if ((internal ? labels.length : images.length) + picked.length > (internal ? 6 : 20)) {
      toast.error(internal ? "Не более 6 фото ярлыков" : "Не более 20 фотографий"); return
    }
    setBusy(true)
    try {
      if (internal) {
        const result = await sdk.admin.upload.create({ files: picked })
        setLabels((previous) => [...previous, ...result.files.map((file, index) => ({ name: picked[index]?.name ?? "Ярлык", url: file.url }))]); setDirty(true)
      } else {
        const result = await sdk.admin.upload.create({ files: picked })
        setImages((previous) => [...new Set([...previous, ...result.files.map((file) => file.url)])]); setDirty(true)
      }
    } catch (e) { toast.error(e instanceof Error ? e.message : "Не удалось загрузить") }
    finally { setBusy(false) }
  }

  function removeLabel(index: number) {
    setLabels(labels.filter((_, i) => i !== index)); setDirty(true)
  }

  if (error) return <div role="alert"><p>{error}</p><Button onClick={() => void load()}>Повторить</Button></div>
  if (!product) return <p role="status">Загрузка карточки…</p>
  return <div className="space-y-6">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <Heading level="h2">{product.title}</Heading>
      <Badge>{product.status === "published" ? "Опубликован" : "Черновик"}</Badge>
      <Link className="text-ui-fg-interactive underline" to={`/products/${id}`} onClick={(event) => { if (dirty && !window.confirm("Перейти без сохранения изменений?")) event.preventDefault() }}>Карточка Medusa</Link>
    </div>
    <div className="flex flex-wrap gap-2" role="tablist" aria-label="Разделы товара">
      {tabs.map((item, index) => <Button key={item} variant={tab === item ? "primary" : "secondary"} role="tab" aria-selected={tab === item} tabIndex={tab === item ? 0 : -1} onClick={() => setTab(item)} onKeyDown={(event) => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return
        event.preventDefault()
        const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length
        setTab(tabs[next]); event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus()
      }}>{item}</Button>)}
    </div>
    <div role="tabpanel" aria-label={tab}>
      {tab === "Карточка" && <div className="grid gap-5 md:grid-cols-2">
        <div><Label htmlFor="product-title">Наименование товара</Label><Input id="product-title" value={title} onChange={(e) => { setTitle(e.target.value); setDirty(true) }} /></div>
        {PROFILE_FIELDS.map(([key, label]) => <div key={key}>
          <Label htmlFor={`profile-${key}`}>{label}</Label>
          {["composition", "lining", "care", "manufacturer_address"].includes(key)
            ? <Textarea id={`profile-${key}`} value={profile[key]} disabled={key === "lining" && profile.no_lining} onChange={(e) => change(key, e.target.value)} />
            : <Input id={`profile-${key}`} value={profile[key]} type={key === "registry_url" ? "url" : "text"} onChange={(e) => change(key, e.target.value)} />}
          {key === "lining" && <label className="mt-2 flex items-center gap-2"><input type="checkbox" checked={profile.no_lining} onChange={(e) => change("no_lining", e.target.checked)} />Без подкладки</label>}
        </div>)}
        <div className="md:col-span-2"><Label htmlFor="product-description">Описание</Label><Textarea id="product-description" value={description} onChange={(e) => { setDescription(e.target.value); setDirty(true) }} /></div>
      </div>}
      {tab === "Варианты и цены" && <div className="space-y-4">
        <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr><th>Цвет / размер</th><th>SKU</th><th>Цена</th></tr></thead><tbody>
          {product.variants?.map((variant) => <tr key={variant.id}><td className="py-3">{variant.title}</td><td>{variant.sku || "Не указан"}</td><td>{variant.prices?.filter((price) => price.currency_code === "rub").map((price) => `${price.amount.toLocaleString("ru-RU")} ₽`).join(", ") || "Не указана"}</td></tr>)}
        </tbody></table></div>
        <Link to={`/products/${id}`} className="text-ui-fg-interactive underline" onClick={(event) => { if (dirty && !window.confirm("Перейти без сохранения изменений?")) event.preventDefault() }}>Изменить варианты, размеры, цвета и цены</Link>
      </div>}
      {tab === "Фотографии" && <div className="space-y-6">
        <Heading level="h3">Фото товара</Heading>
        <input aria-label="Загрузить фотографии товара" type="file" accept="image/jpeg,image/png,image/webp" multiple disabled={busy} onChange={(e) => { void upload(e.target.files, false); e.target.value = "" }} />
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">{images.map((url, index) => <div key={url} className="min-w-0 space-y-2">
          <img src={resolveMediaPreviewUrl(url, storefront)} alt={`Ракурс ${index + 1}`} className="aspect-[3/4] w-full rounded object-cover" />
          {index === 0 && <Badge>Главное фото</Badge>}
          <div className="flex gap-1">{([-1, 1] as const).map((direction) => <button key={direction} type="button" title={direction < 0 ? "Раньше" : "Позже"} aria-label={direction < 0 ? "Раньше" : "Позже"} disabled={busy || index + direction < 0 || index + direction >= images.length} onClick={() => {
            const next = [...images]; [next[index], next[index + direction]] = [next[index + direction], next[index]]; setImages(next); setDirty(true)
          }}>{direction < 0 ? <ArrowUpMini /> : <ArrowDownMini />}</button>)}<button type="button" title="Убрать из карточки" aria-label="Убрать из карточки" disabled={busy} onClick={() => { setImages(images.filter((_, i) => i !== index)); setDirty(true) }}><Trash /></button></div>
        </div>)}</div>
        <Heading level="h3">Фото этикеток и вшивных ярлыков</Heading>
        <Badge>Видны покупателям</Badge>
        <>
          <input aria-label="Загрузить фото ярлыков" type="file" accept="image/jpeg,image/png,image/webp" multiple disabled={busy} onChange={(e) => { void upload(e.target.files, true); e.target.value = "" }} />
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3">{labels.map((image, index) => <div key={`${image.name}-${index}`}><img src={resolveMediaPreviewUrl(image.url, storefront)} alt={image.name} className="aspect-square w-full object-contain" /><button title="Убрать фото ярлыка" aria-label="Убрать фото ярлыка" disabled={busy} onClick={() => removeLabel(index)}><Trash /></button></div>)}</div>
        </>
      </div>}
      {tab === "Каталог" && <div className="space-y-5">
        <fieldset className="space-y-2"><legend>Категории</legend>{categories.map((category) => <label key={category.id} className="flex items-center gap-2"><input type="checkbox" checked={categoryIds.includes(category.id)} onChange={(e) => { setCategoryIds(e.target.checked ? [...categoryIds, category.id] : categoryIds.filter((value) => value !== category.id)); setDirty(true) }} />{category.name}</label>)}</fieldset>
        <div><Label htmlFor="product-collection">Коллекция</Label><select id="product-collection" className="bg-ui-bg-field border-ui-border-base w-full rounded border p-2 text-sm" value={collectionId} onChange={(e) => { setCollectionId(e.target.value); setDirty(true) }}><option value="">Без коллекции</option>{collections.map((collection) => <option key={collection.id} value={collection.id}>{collection.title}</option>)}</select></div>
      </div>}
      {tab === "Метрики" && <div className="space-y-3"><Heading level="h3">Яндекс.Метрика</Heading><Badge>Не подключена</Badge><p>Просмотры, добавления в корзину и конверсия недоступны до подключения счётчика и источника отчётов.</p><p className="break-all text-sm">ID товара: {id}</p></div>}
    </div>
    <div className="border-ui-border-base space-y-3 border-t pt-4">
      {!!missing.length && <details><summary>Не заполнено: {missing.length}</summary><ul className="list-disc pl-5 text-sm">{missing.map((item) => <li key={item}>{item}</li>)}</ul></details>}
      {!labels.length && <p className="text-ui-fg-subtle text-sm">Фото ярлыков ещё не добавлены.</p>}
      <div className="flex flex-wrap gap-2"><Button variant="secondary" disabled={busy} onClick={() => void save("draft")}>{product.status === "published" ? "Снять с публикации и сохранить" : "Сохранить черновик"}</Button><Button disabled={busy || missing.length > 0} onClick={() => void save("published")}>{product.status === "published" ? "Сохранить опубликованным" : "Опубликовать"}</Button>{dirty && <Badge>Есть несохранённые изменения</Badge>}</div>
    </div>
  </div>
}
