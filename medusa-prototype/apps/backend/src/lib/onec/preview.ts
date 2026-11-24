import { SaxesParser } from "saxes"
import { decodeCommerceXml, inspectCommerceXml } from "./xml"
import { FILE_LIMIT } from "./exchange"

type XmlNode = { name: string; attrs: Record<string, string>; text: string; children: XmlNode[] }
const many = (node: XmlNode | undefined, name: string) => node?.children.filter(child => child.name === name) ?? []
const one = (node: XmlNode | undefined, name: string) => many(node, name)[0]
const text = (node: XmlNode | undefined, name: string) => one(node, name)?.text.trim() ?? ""
export class PreviewError extends Error {}

function tree(bytes: Buffer) {
  if (bytes.length > FILE_LIMIT) throw new PreviewError("XML exceeds preview limit")
  inspectCommerceXml(bytes)
  const parser = new SaxesParser({ xmlns: true })
  const stack: XmlNode[] = []
  let root: XmlNode | undefined
  let nodes = 0
  parser.on("doctype", () => { throw new PreviewError("DTD is forbidden") })
  parser.on("opentag", tag => {
    if (++nodes > 100_000) throw new PreviewError("Too many XML elements")
    const node: XmlNode = { name: tag.local, attrs: Object.fromEntries(Object.values(tag.attributes).map(attribute => [attribute.local, attribute.value])), text: "", children: [] }
    if (stack.length) stack[stack.length - 1].children.push(node)
    else root = node
    stack.push(node)
  })
  parser.on("text", value => { if (stack.length) stack[stack.length - 1].text += value })
  parser.on("cdata", value => { if (stack.length) stack[stack.length - 1].text += value })
  parser.on("closetag", () => { stack.pop() })
  parser.write(decodeCommerceXml(bytes)).close()
  return root!
}

export function parseCatalog(bytes: Buffer) {
  const root = tree(bytes)
  const catalog = one(root, "Каталог")
  if (!catalog || !text(catalog, "Ид")) throw new PreviewError("Catalog is missing")
  return {
    catalogId: text(catalog, "Ид"), classifierId: text(catalog, "ИдКлассификатора"), generatedAt: root.attrs.ДатаФормирования ?? "",
    products: many(one(catalog, "Товары"), "Товар").map(product => ({ id: text(product, "Ид"), article: text(product, "Артикул"), name: text(product, "Наименование") })),
  }
}
export function parseOffers(bytes: Buffer) {
  const root = tree(bytes)
  const packet = one(root, "ПакетПредложений")
  if (!packet || !text(packet, "ИдКаталога")) throw new PreviewError("Offer catalog reference is missing")
  return {
    catalogId: text(packet, "ИдКаталога"), classifierId: text(packet, "ИдКлассификатора"), generatedAt: root.attrs.ДатаФормирования ?? "",
    priceTypes: many(one(packet, "ТипыЦен"), "ТипЦены").map(node => ({ id: text(node, "Ид"), name: text(node, "Наименование"), currency: text(node, "Валюта") })),
    warehouses: many(one(packet, "Склады"), "Склад").map(node => ({ id: text(node, "Ид"), name: text(node, "Наименование") })),
    offers: many(one(packet, "Предложения"), "Предложение").map(offer => ({
      id: text(offer, "Ид"), name: text(offer, "Наименование"), article: text(offer, "Артикул"), totalQuantity: text(offer, "Количество"),
      properties: many(one(offer, "ХарактеристикиТовара"), "ХарактеристикаТовара").map(node => ({ name: text(node, "Наименование"), value: text(node, "Значение") })),
      prices: many(one(offer, "Цены"), "Цена").map(node => ({ typeId: text(node, "ИдТипаЦены"), amount: text(node, "ЦенаЗаЕдиницу"), currency: text(node, "Валюта"), factor: text(node, "Коэффициент"), unit: text(node, "Единица") })),
      stocks: many(offer, "Склад").map(node => ({ warehouseId: node.attrs.ИдСклада ?? text(node, "ИдСклада"), quantity: node.attrs.КоличествоНаСкладе ?? text(node, "КоличествоНаСкладе") })),
    })),
  }
}

export type StoreProduct = {
  id: string; title: string; status?: string; metadata?: Record<string, unknown> | null
  options?: { id: string; title: string }[]
  variants?: { id: string; title: string; sku?: string | null; metadata?: Record<string, unknown> | null; options?: { value: string; option_id: string }[]; price_set?: { prices?: { amount: number | string; currency_code: string; price_list_id?: string | null; min_quantity?: number | null; max_quantity?: number | null; rules?: Record<string, unknown>; price_rules?: unknown[] }[] } }[]
}
export const normalizeColor = (value: string) => value.normalize("NFKC").trim().toLocaleLowerCase("ru").replace(/ё/g, "е").replace(/[\s\-‐‑–—]+/gu, " ")
export function normalizeSize(value: string) {
  const normalized = value.normalize("NFKC").trim().toUpperCase().replace(/[\s_-]+/g, " ")
  return ["ONE SIZE", "ONESIZE", "OS", "O/S"].includes(normalized) ? "OS" : normalized
}
function dimensions(properties: { name: string; value: string }[]) {
  const values = (pattern: RegExp) => [...new Set(properties.filter(property => pattern.test(property.name.trim())).map(property => property.value.trim()).filter(Boolean))]
  const colors = values(/^цвет(?:\s*\(|$)/iu)
  const sizes = values(/^размер(?:\s+ru)?(?:\s*\(|$)/iu)
  return { color: colors.length === 1 ? colors[0] : "", size: sizes.length === 1 ? sizes[0] : "" }
}
function storeDimensions(product: StoreProduct, variant: NonNullable<StoreProduct["variants"]>[number]) {
  return dimensions((variant.options ?? []).map(option => ({ name: product.options?.find(definition => definition.id === option.option_id)?.title || "", value: option.value })))
}
function minor(value: unknown) {
  const match = /^(\d+)(?:[.,](\d{1,2}))?$/.exec(String(value))
  if (!match) return null
  const amount = BigInt(match[1]) * 100n + BigInt((match[2] || "").padEnd(2, "0"))
  return amount <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(amount) : null
}
const rubles = (value: string) => ["rub", "rur", "руб", "руб."].includes(value.trim().toLowerCase())
const quantity = (value: string) => /^-?\d+(?:[.,]\d{1,6})?$/.test(value) && Number.isFinite(Number(value.replace(",", "."))) ? Number(value.replace(",", ".")) : null
const unique = (values: string[]) => [...new Set(values)]

export function buildPreview(catalog: ReturnType<typeof parseCatalog>, data: ReturnType<typeof parseOffers>, products: StoreProduct[]) {
  if (catalog.catalogId !== data.catalogId || !catalog.classifierId || catalog.classifierId !== data.classifierId) throw new PreviewError("Files belong to different catalogs")
  if (!catalog.generatedAt || catalog.generatedAt !== data.generatedAt) throw new PreviewError("Files must belong to the same export timestamp")
  const sourceIds = catalog.products.map(product => product.id)
  if (sourceIds.some(id => !id) || new Set(sourceIds).size !== sourceIds.length) throw new PreviewError("Duplicate or missing product IDs")
  const sourceTypes = data.priceTypes.filter(type => type.id)
  const priceType = sourceTypes.length === 1 ? sourceTypes[0] : null
  const groups = new Map<string, number>()
  const offerIds = new Map<string, number>()
  for (const offer of data.offers) {
    offerIds.set(offer.id, (offerIds.get(offer.id) || 0) + 1)
    const { color, size } = dimensions(offer.properties)
    if (color && size) {
      const key = offer.id.split("#")[0] + "|" + normalizeColor(color) + "|" + normalizeSize(size)
      groups.set(key, (groups.get(key) || 0) + 1)
    }
  }
  const warehouseIds = data.warehouses.map(warehouse => warehouse.id)
  const duplicateWarehouses = warehouseIds.some((id, index) => !id || warehouseIds.indexOf(id) !== index)
  const productRows = catalog.products.map(source => {
    const bound = products.filter(product => product.status !== "rejected" && product.metadata?.onec_product_id === source.id)
    const byArticle = products.filter(product => product.status !== "rejected" && String((product.metadata?.catalog_profile as Record<string, unknown> | undefined)?.model ?? "").trim() === source.article && !!source.article)
    const candidates = bound.length ? bound : byArticle
    return { source, candidates, target: candidates.length === 1 ? candidates[0] : null, method: bound.length ? "stored_id" : "article" }
  })
  const claimed = new Map<string, number>()
  for (const row of productRows) if (row.target) claimed.set(row.target.id, (claimed.get(row.target.id) || 0) + 1)
  const rows = data.offers.map(offer => {
    const [sourceProductId, characteristicId, ...extra] = offer.id.split("#")
    const productRow = productRows.find(row => row.source.id === sourceProductId)
    const product = productRow?.target && claimed.get(productRow.target.id) === 1 ? productRow.target : null
    const { color, size } = dimensions(offer.properties)
    const warnings: string[] = []
    const stocks = offer.stocks.map(stock => {
      const definitions = data.warehouses.filter(warehouse => warehouse.id === stock.warehouseId)
      const parsed = quantity(stock.quantity)
      if (parsed === null) warnings.push("invalid_quantity")
      if (parsed !== null && parsed < 0) warnings.push("negative_quantity")
      if (definitions.length !== 1) warnings.push("unknown_or_duplicate_warehouse")
      return { ...stock, warehouseName: definitions.length === 1 ? definitions[0].name : stock.warehouseId, eligible: false }
    })
    if (new Set(offer.stocks.map(stock => stock.warehouseId)).size !== offer.stocks.length) warnings.push("duplicate_stock_row")
    let status: "linked" | "candidate" | "ambiguous" | "missing" | "parent" = "missing"
    let variant: NonNullable<StoreProduct["variants"]>[number] | null = null
    let method = "none"
    const bindings = product?.variants?.filter(variant => variant.metadata?.onec_offer_id === offer.id) ?? []
    const key = sourceProductId + "|" + normalizeColor(color) + "|" + normalizeSize(size)
    const matches = product && color && size ? (product.variants ?? []).filter(candidate => {
      const target = storeDimensions(product, candidate)
      return !!target.color && !!target.size && normalizeColor(target.color) === normalizeColor(color) && normalizeSize(target.size) === normalizeSize(size)
    }) : []
    if (!offer.id || extra.length || (offer.id.includes("#") && !characteristicId)) { warnings.push("invalid_offer_id") }
    else if ((offerIds.get(offer.id) || 0) > 1) { status = "ambiguous"; warnings.push("duplicate_offer_id") }
    else if (!characteristicId && !color && !size) { status = "parent"; warnings.push("parent_offer") }
    else if (!productRow) { warnings.push("product_not_in_catalog") }
    else if (!product) { status = productRow.candidates.length || productRow.target ? "ambiguous" : "missing"; warnings.push("product_not_unique") }
    else if (bindings.length > 1) { status = "ambiguous"; warnings.push("duplicate_binding") }
    else if (bindings.length === 1) {
      status = "linked"; variant = bindings[0]; method = "stored_id"
      const target = storeDimensions(product, variant)
      const hasDisplayBinding = typeof variant.metadata?.onec_display_color === "string" && typeof variant.metadata?.onec_display_size === "string"
      const bindingLabelsMatch = !hasDisplayBinding || (target.color === variant.metadata?.onec_display_color && target.size === variant.metadata?.onec_display_size)
      const boundColor = hasDisplayBinding ? String(variant.metadata?.onec_color ?? "") : target.color
      const boundSize = hasDisplayBinding ? String(variant.metadata?.onec_size ?? "") : target.size
      if (!bindingLabelsMatch || !color || !size || !boundColor || !boundSize || normalizeColor(boundColor) !== normalizeColor(color) || normalizeSize(boundSize) !== normalizeSize(size)) {
        status = "ambiguous"; warnings.push("bound_dimensions_differ")
      }
    }
    else if (!color || !size) { warnings.push("missing_dimensions") }
    else if ((groups.get(key) || 0) > 1) { status = "ambiguous"; warnings.push("similar_source_characteristics") }
    else {
      if (matches.length === 1) { status = "candidate"; variant = matches[0]; method = "dimensions"; warnings.push("binding_not_confirmed") }
      else if (matches.length > 1) { status = "ambiguous"; warnings.push("duplicate_store_variants") }
      else warnings.push("variant_not_found")
    }
    const matchingPrices = priceType ? offer.prices.filter(price => price.typeId === priceType.id) : []
    const incoming = matchingPrices.length === 1 && rubles(matchingPrices[0].currency) && quantity(matchingPrices[0].factor) === 1 && ["шт", "шт."].includes(matchingPrices[0].unit.trim().toLowerCase()) ? minor(matchingPrices[0].amount) : null
    if (incoming === null || incoming <= 0) warnings.push("price_not_unique_or_unsupported")
    const existing = (variant?.price_set?.prices ?? []).filter(price => price.currency_code === "rub" && !price.price_list_id && price.min_quantity == null && price.max_quantity == null && !price.price_rules?.length && !Object.keys(price.rules ?? {}).length)
    const current = existing.length === 1 ? minor(existing[0].amount) : null
    if (variant && current === null) warnings.push("store_price_not_unique")
    return {
      sourceOfferId: offer.id, sourceProductId, characteristicId: characteristicId || null, name: offer.name, color, size, status, method,
      target: variant && product ? { productId: product.id, variantId: variant.id, title: variant.title, sku: variant.sku ?? "" } : null,
      suggestions: !variant && product ? matches.map(candidate => ({ productId: product.id, variantId: candidate.id, title: candidate.title, sku: candidate.sku ?? "" })) : [],
      price: { currency: "rub", incoming: incoming === null ? null : incoming / 100, current: current === null ? null : current / 100, changed: incoming === null || current === null ? null : incoming !== current },
      reportedQuantity: offer.totalQuantity, proposedQuantity: null, stocks, warnings: unique(warnings),
    }
  })
  // Never propose two source records for one target, even when persisted IDs exist.
  const targetClaims = new Map<string, number>()
  rows.forEach(row => { if (row.target) targetClaims.set(row.target.variantId, (targetClaims.get(row.target.variantId) || 0) + 1) })
  rows.forEach(row => { if (row.target && (targetClaims.get(row.target.variantId) || 0) > 1) { row.status = "ambiguous"; row.warnings.push("target_claimed_twice"); row.target = null } })
  return {
    mode: "preview" as const, appliesChanges: false, catalogId: catalog.catalogId, generatedAt: catalog.generatedAt,
    priceType, products: productRows.map(row => ({ source: row.source, method: row.method, candidates: row.candidates.map(product => ({ id: product.id, title: product.title, variantCount: product.variants?.length ?? 0 })) })),
    summary: { products: catalog.products.length, offers: rows.length, candidates: rows.filter(row => row.status === "candidate").length, linked: rows.filter(row => row.status === "linked").length, ambiguous: rows.filter(row => row.status === "ambiguous").length, missing: rows.filter(row => row.status === "missing").length, parent: rows.filter(row => row.status === "parent").length, priceDifferences: rows.filter(row => row.price.changed === true).length },
    warnings: ["warehouse_allowlist_not_confirmed", "quantity_semantics_not_confirmed", ...(duplicateWarehouses ? ["duplicate_warehouse_definitions"] : []), ...(!priceType ? ["price_type_not_unique"] : [])],
    warehouses: data.warehouses.map(warehouse => ({ ...warehouse, eligible: false })), rows,
  }
}
