import { createHash } from "node:crypto"
import { buildPreview, normalizeColor, normalizeSize, type parseCatalog, type parseOffers, type StoreProduct } from "./preview"
import { ONEC_CATALOG_ARTICLES } from "./scope"
import { LEGACY_VARIANT_MIGRATIONS } from "./legacy-migrations"

export type SyncProduct = Omit<StoreProduct, "options"> & {
  weight?: number | null; length?: number | null; width?: number | null; height?: number | null
  options?: { id: string; title: string; values?: { value: string }[] }[]
}
export class SyncPlanError extends Error {}
const fail = (message: string): never => { throw new SyncPlanError(message) }
const tuple = (...values: string[]) => JSON.stringify(values)
const canonical = (value: unknown): unknown => Array.isArray(value)
  ? value.map(canonical).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
  : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical((value as Record<string, unknown>)[key])])) : value
export const syncDigest = (value: unknown) => createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex")
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}

export function planCatalogSync(catalog: ReturnType<typeof parseCatalog>, offers: ReturnType<typeof parseOffers>, products: SyncProduct[], articles: string[]) {
  if (!articles.length || new Set(articles).size !== articles.length || articles.some(article => !ONEC_CATALOG_ARTICLES.some(allowed => allowed === article))) fail("Select distinct approved articles")
  const report = buildPreview(catalog, offers, products)
  const actions = [...articles].sort().map(article => {
    const sourceProducts = catalog.products.filter(product => product.article === article)
    if (sourceProducts.length !== 1) fail(`Article ${article}: expected exactly one source product`)
    const source = sourceProducts[0]
    const bound = products.filter(product => product.metadata?.onec_product_id === source.id)
    const candidates = bound.length ? bound : products.filter(product => String(record(product.metadata?.catalog_profile).model ?? "").trim() === article && product.status !== "rejected")
    if (candidates.length !== 1) fail(`Article ${article}: expected exactly one existing site product`)
    const product = candidates[0]
    const metadata = product.metadata ?? {}
    if (product.status === "rejected") fail(`Article ${article}: rejected product`)
    if (metadata.onec_catalog_id && metadata.onec_catalog_id !== catalog.catalogId) fail(`Article ${article}: catalog binding differs`)
    if (metadata.onec_product_id && metadata.onec_product_id !== source.id) fail(`Article ${article}: product binding differs`)
    if (typeof metadata.onec_last_export === "string" && metadata.onec_last_export > catalog.generatedAt) fail(`Article ${article}: stale export`)
    const definitions = product.options ?? []
    if (definitions.length !== 2 || definitions.filter(option => option.title === "Цвет").length !== 1 || definitions.filter(option => option.title === "Размер").length !== 1) fail(`Article ${article}: expected only color and size options`)
    const colorOption = definitions.find(option => option.title === "Цвет")!
    const sizeOption = definitions.find(option => option.title === "Размер")!
    const variants = product.variants ?? []
    const dims = (variant: typeof variants[number]) => ({ color: variant.options?.find(option => option.option_id === colorOption.id)?.value ?? "", size: variant.options?.find(option => option.option_id === sizeOption.id)?.value ?? "" })
    const rows = report.rows.filter(row => row.sourceProductId === source.id && row.status !== "parent").sort((a, b) => a.sourceOfferId.localeCompare(b.sourceOfferId))
    if (!rows.length) fail(`Article ${article}: no sellable source characteristics`)
    const ids = new Set<string>()
    for (const row of rows) {
      if (!row.characteristicId || ids.has(row.sourceOfferId) || row.sourceOfferId.split("#").length !== 2 || !row.color || !row.size || row.color.length > 150 || row.size.length > 50 || row.price.incoming === null || row.price.incoming <= 0) fail(`Article ${article}: invalid source characteristic or price`)
      ids.add(row.sourceOfferId)
      if (products.some(other => other.id !== product.id && other.variants?.some(variant => variant.metadata?.onec_offer_id === row.sourceOfferId))) fail(`Article ${article}: offer already belongs to another product`)
    }
    const assigned = new Map<string, typeof variants[number]>()
    const claimed = new Set<string>()
    for (const row of rows) {
      const bindings = variants.filter(variant => variant.metadata?.onec_offer_id === row.sourceOfferId)
      if (bindings.length > 1) fail(`Article ${article}: duplicate existing offer binding`)
      if (bindings.length) {
        const variant = bindings[0]
        if (variant.metadata?.onec_catalog_id && variant.metadata.onec_catalog_id !== catalog.catalogId) fail(`Article ${article}: variant catalog binding differs`)
        if ((variant.metadata?.onec_display_color && variant.metadata.onec_display_color !== dims(variant).color) || (variant.metadata?.onec_display_size && variant.metadata.onec_display_size !== dims(variant).size)) fail(`Article ${article}: bound site option labels were changed`)
        if (normalizeColor(String(variant.metadata?.onec_color ?? dims(variant).color)) !== normalizeColor(row.color) || normalizeSize(String(variant.metadata?.onec_size ?? dims(variant).size)) !== normalizeSize(row.size)) fail(`Article ${article}: bound characteristic changed dimensions`)
        assigned.set(row.sourceOfferId, variant); claimed.add(variant.id)
      }
    }
    const migrations: { sku: string; offerId: string }[] = []
    for (const migration of LEGACY_VARIANT_MIGRATIONS.filter(migration => migration.article === article)) {
      const targets = variants.filter(variant => variant.sku === migration.sku)
      if (!targets.length) continue
      if (targets.length !== 1) fail(`Article ${article}: duplicate migration SKU`)
      const target = targets[0]
      if (target.metadata?.onec_offer_id) {
        if (target.metadata.onec_offer_id !== migration.offerId) fail(`Article ${article}: migration conflicts with saved binding`)
        continue
      }
      if (dims(target).color !== migration.color || normalizeSize(dims(target).size) !== "OS") fail(`Article ${article}: legacy migration label changed`)
      const row = rows.find(row => row.sourceOfferId === migration.offerId) ?? fail(`Article ${article}: reviewed migration source changed`)
      if (row.color !== migration.sourceColor || normalizeSize(row.size) !== "OS") fail(`Article ${article}: reviewed migration source changed`)
      if (assigned.has(row.sourceOfferId) || claimed.has(target.id)) fail(`Article ${article}: reviewed migration target is already claimed`)
      assigned.set(row.sourceOfferId, target); claimed.add(target.id)
      migrations.push({ sku: migration.sku, offerId: migration.offerId })
    }
    const groups = new Map<string, typeof rows>()
    for (const row of rows) {
      const key = tuple(normalizeColor(row.color), normalizeSize(row.size))
      groups.set(key, [...(groups.get(key) ?? []), row])
    }
    for (const group of groups.values()) {
      const remaining = group.filter(row => !assigned.has(row.sourceOfferId))
      if (!remaining.length) continue
      const targets = variants.filter(variant => !claimed.has(variant.id) && !variant.metadata?.onec_offer_id && normalizeColor(dims(variant).color) === normalizeColor(group[0].color) && normalizeSize(dims(variant).size) === normalizeSize(group[0].size))
      if (targets.length > 1) fail(`Article ${article}: multiple unbound site variants for one color/size`)
      if (targets.length === 1) {
        const target = targets[0]
        const exact = remaining.filter(row => row.color === dims(target).color)
        const chosen = (exact.length ? exact : remaining)[0]
        assigned.set(chosen.sourceOfferId, target); claimed.add(target.id)
      }
    }
    const occupied = new Set(variants.map(variant => tuple(dims(variant).color, dims(variant).size)))
    const sizes = [...new Set([...(sizeOption.values ?? []).map(value => value.value), ...variants.map(variant => dims(variant).size)].filter(Boolean))]
    for (const variant of variants) {
      const dimension = dims(variant)
      if (!dimension.color || !dimension.size) fail(`Article ${article}: site variant lacks dimensions`)
    }
    const create: { product_id: string; title: string; sku: string; options: Record<string, string>; prices: { currency_code: string; amount: number }[]; metadata: Record<string, unknown>; manage_inventory: boolean; allow_backorder: boolean; weight?: number; length?: number; width?: number; height?: number }[] = []
    const update: { id: string; metadata: Record<string, unknown>; prices?: { currency_code: string; amount: number }[] }[] = []
    const links: { offerId: string; variantId: string | null; sku: string; color: string; size: string; price: number }[] = []
    for (const group of groups.values()) {
      const ordered = [...group.filter(row => assigned.has(row.sourceOfferId)), ...group.filter(row => !assigned.has(row.sourceOfferId))]
      for (const [index, row] of ordered.entries()) {
        const variant = assigned.get(row.sourceOfferId)
        const fields = { onec_catalog_id: catalog.catalogId, onec_offer_id: row.sourceOfferId, onec_color: row.color, onec_size: row.size }
        if (variant) {
          const prices = variant.price_set?.prices ?? []
          if (prices.length > 1 || prices.some(price => price.currency_code !== "rub" || price.price_list_id || price.min_quantity != null || price.max_quantity != null || price.price_rules?.length || Object.keys(price.rules ?? {}).length)) fail(`Article ${article}: unsupported existing prices; preserve them for manual review`)
          const priceChanged = prices.length !== 1 || Number(prices[0].amount) !== row.price.incoming
          const meta = { ...(variant.metadata ?? {}), ...fields, onec_display_color: dims(variant).color, onec_display_size: dims(variant).size }
          if (priceChanged || syncDigest(meta) !== syncDigest(variant.metadata ?? {})) update.push({ id: variant.id, metadata: meta, ...(priceChanged ? { prices: [{ currency_code: "rub", amount: row.price.incoming! }] } : {}) })
          const dimension = dims(variant)
          links.push({ offerId: row.sourceOfferId, variantId: variant.id, sku: variant.sku ?? "", ...dimension, price: row.price.incoming! })
        } else {
          const equivalentSizes = sizes.filter(value => normalizeSize(value) === normalizeSize(row.size))
          if (equivalentSizes.length > 1) fail(`Article ${article}: multiple site labels for one size`)
          const size = equivalentSizes[0] || (normalizeSize(row.size) === "OS" ? "ONE SIZE" : row.size)
          let suffix = index + 1
          let color = index ? `${row.color} (вариант ${suffix})` : row.color
          while (occupied.has(tuple(color, size))) color = `${row.color} (вариант ${++suffix})`
          occupied.add(tuple(color, size)); sizes.push(...(sizes.includes(size) ? [] : [size]))
          const sku = `MM-1C-${article}-${syncDigest([catalog.catalogId, row.sourceOfferId]).slice(0, 16)}`
          if (products.some(other => other.variants?.some(candidate => candidate.sku === sku))) fail(`Article ${article}: generated SKU is already in use without a binding`)
          const packaging = Object.fromEntries((["weight", "length", "width", "height"] as const).flatMap(key => typeof product[key] === "number" && product[key]! > 0 ? [[key, product[key]]] : []))
          create.push({ product_id: product.id, title: `${size} / ${color}`, sku, options: { Цвет: color, Размер: size }, prices: [{ currency_code: "rub", amount: row.price.incoming! }], metadata: { ...fields, onec_display_color: color, onec_display_size: size }, manage_inventory: true, allow_backorder: false, ...packaging })
          links.push({ offerId: row.sourceOfferId, variantId: null, sku, color, size, price: row.price.incoming! })
        }
      }
    }
    const optionUpdates = definitions.flatMap(option => {
      // In Medusa 2.22 a global option value isn't necessarily allowed for this
      // product. Explicitly link only values used by the new variants.
      const values = [...new Set(create.map(variant => variant.options[option.title]))]
      return values.length ? [{ id: option.id, values }] : []
    })
    const nextMetadata: Record<string, unknown> = { ...metadata, onec_catalog_id: catalog.catalogId, onec_product_id: source.id, onec_last_export: catalog.generatedAt }
    return { article, productId: product.id, sourceProductId: source.id, create, update, optionUpdates, metadata: nextMetadata, updateMetadata: syncDigest(nextMetadata) !== syncDigest(metadata), links, migrations, untouchedVariantIds: variants.filter(variant => !claimed.has(variant.id)).map(variant => variant.id), before: product }
  })
  if (new Set(actions.map(action => action.productId)).size !== actions.length) fail("Multiple source products target the same site product")
  const body = { version: 1, catalogId: catalog.catalogId, generatedAt: catalog.generatedAt, inventoryWrites: false, actions }
  return { ...body, sha256: syncDigest(body), summary: { products: actions.length, create: actions.reduce((sum, action) => sum + action.create.length, 0), update: actions.reduce((sum, action) => sum + action.update.length, 0), untouched: actions.reduce((sum, action) => sum + action.untouchedVariantIds.length, 0) } }
}
