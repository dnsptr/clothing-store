import { planCatalogSync, SyncPlanError, type SyncProduct } from "../sync-plan"
import type { parseCatalog, parseOffers } from "../preview"
import { applyCatalogPlan } from "../apply-plan"

const catalog: ReturnType<typeof parseCatalog> = { catalogId: "catalog", classifierId: "classifier", generatedAt: "2026-11-24T01:00:00", products: [{ id: "source", article: "1916", name: "1C title" }] }
const offer = (id: string, color = "бежевый", size = "One size") => ({ id: `source#${id}`, name: "1C title", article: "1916", totalQuantity: "100", properties: [{ name: "Цвет", value: color }, { name: "Размер", value: size }], prices: [{ typeId: "retail", amount: "5500", currency: "руб", factor: "1", unit: "шт" }], stocks: [{ warehouseId: "warehouse", quantity: "100" }] })
const offers = (rows = [offer("a"), offer("b"), offer("m", "белый", "M")]): ReturnType<typeof parseOffers> => ({ catalogId: catalog.catalogId, classifierId: catalog.classifierId, generatedAt: catalog.generatedAt, priceTypes: [{ id: "retail", name: "Розничная цена", currency: "руб" }], warehouses: [{ id: "warehouse", name: "Мосмарт" }], offers: rows })
const product = (): SyncProduct => ({ id: "product", title: "Keep storefront title", status: "published", weight: 350, metadata: { catalog_profile: { model: "1916", label_images: ["keep-image"] }, other: "keep" }, options: [{ id: "color", title: "Цвет", values: [{ value: "бежевый" }] }, { id: "size", title: "Размер", values: [{ value: "ONE SIZE" }] }], variants: [{ id: "existing", title: "Keep variant title", sku: "KEEP-SKU", metadata: { other: "keep-variant" }, options: [{ option_id: "color", value: "бежевый" }, { option_id: "size", value: "ONE SIZE" }], price_set: { prices: [{ amount: 3990, currency_code: "rub" }] } }] })
const plan = (products = [product()], data = offers(), source = catalog, articles = ["1916"]) => planCatalogSync(source, data, products, articles)

it("preserves existing IDs/SKUs, separates equal characteristics and never proposes stock updates", () => {
  const existing = product()
  const before = JSON.stringify(existing)
  const result = plan([existing])
  expect(result.summary).toEqual({ products: 1, create: 2, update: 1, untouched: 0 })
  const action = result.actions[0]
  expect(action.links.find(link => link.offerId === "source#a")).toMatchObject({ variantId: "existing", sku: "KEEP-SKU", price: 5500 })
  expect(action.create.find(variant => variant.metadata.onec_offer_id === "source#b")?.options.Цвет).toBe("бежевый (вариант 2)")
  expect(action.create.every(variant => variant.manage_inventory && !variant.allow_backorder)).toBe(true)
  expect(action.create[0].weight).toBe(350)
  expect(action.update[0]).toEqual({ id: "existing", metadata: expect.objectContaining({ other: "keep-variant", onec_offer_id: "source#a" }), prices: [{ currency_code: "rub", amount: 5500 }] })
  expect(action.metadata.catalog_profile).toEqual(existing.metadata!.catalog_profile)
  expect(result.inventoryWrites).toBe(false)
  expect(JSON.stringify(existing)).toBe(before)
})
function simulate(result: ReturnType<typeof plan>, snapshot = product()): SyncProduct {
  const next = JSON.parse(JSON.stringify(snapshot)) as SyncProduct
  const action = result.actions[0]
  next.metadata = action.metadata
  for (const option of action.optionUpdates) {
    const target = next.options!.find(item => item.id === option.id)!
    target.values = [...new Set([...(target.values ?? []).map(item => item.value), ...option.values])].map(value => ({ value }))
  }
  for (const update of action.update) {
    const target = next.variants!.find(variant => variant.id === update.id)!
    target.metadata = update.metadata
    if (update.prices) target.price_set = { prices: update.prices }
  }
  for (const created of action.create) next.variants!.push({ id: `new-${created.sku}`, title: created.title, sku: created.sku, metadata: created.metadata, options: Object.entries(created.options).map(([title, value]) => ({ option_id: next.options!.find(option => option.title === title)!.id, value })), price_set: { prices: created.prices } })
  return next
}
it("is a no-op on a second run and preserves source-ID links when input order changes", () => {
  const first = plan()
  const synced = simulate(first)
  const second = plan([synced], offers([...offers().offers].reverse()))
  expect(second.summary.create).toBe(0)
  expect(second.summary.update).toBe(0)
  expect(second.actions[0].optionUpdates).toEqual([])
  expect(second.actions[0].updateMetadata).toBe(false)
  expect(second.actions[0].links.map(link => link.offerId).sort()).toEqual(first.actions[0].links.map(link => link.offerId).sort())
})
it("recovers after additive option updates without making duplicate color labels or SKUs", () => {
  const first = plan()
  const snapshot = product()
  for (const option of first.actions[0].optionUpdates) snapshot.options!.find(item => item.id === option.id)!.values = option.values.map(value => ({ value }))
  expect(plan([snapshot]).actions[0].create).toEqual(first.actions[0].create)
})
it("keeps unrelated legacy variants without deleting or changing their inventory settings", () => {
  const snapshot = product()
  snapshot.variants!.push({ id: "legacy", title: "Legacy", sku: "legacy", options: [{ option_id: "color", value: "зелёный" }, { option_id: "size", value: "ONE SIZE" }] })
  const action = plan([snapshot]).actions[0]
  expect(action.untouchedVariantIds).toEqual(["legacy"])
  expect(action.update.every(update => update.id !== "legacy")).toBe(true)
  expect(Object.keys(action)).not.toContain("delete")
})
it("rejects unapproved articles, missing products, conflicting bindings and older exports", () => {
  expect(() => plan(undefined, undefined, undefined, ["99999"])).toThrow(SyncPlanError)
  expect(() => plan([])).toThrow(SyncPlanError)
  const existing = product()
  existing.metadata!.onec_catalog_id = "other"
  expect(() => plan([existing])).toThrow("catalog binding differs")
  existing.metadata = { catalog_profile: { model: "1916" }, onec_last_export: "2026-11-25T01:00:00" }
  expect(() => plan([existing])).toThrow("stale export")
})
it("rejects ambiguous site matches, repeated offer IDs and multiple price types before any writes", () => {
  expect(() => plan([product(), { ...product(), id: "other" }])).toThrow(SyncPlanError)
  expect(() => plan([product()], offers([offer("a"), offer("a")]))).toThrow(SyncPlanError)
  const data = offers()
  data.priceTypes.push({ id: "wholesale", name: "Wholesale", currency: "rub" })
  expect(() => plan([product()], data)).toThrow(SyncPlanError)
})
it("does not inherit a parent price or overwrite foreign/tiered prices", () => {
  const data = offers([offer("a")])
  data.offers[0].prices = []
  data.offers.unshift({ ...offer("parent"), id: "source", properties: [] })
  expect(() => plan([product()], data)).toThrow(SyncPlanError)
  const existing = product()
  existing.variants![0].price_set!.prices!.push({ amount: 50, currency_code: "usd" })
  expect(() => plan([existing])).toThrow("unsupported existing prices")
})
it("detects changed labels on a bound variant and a generated SKU used elsewhere", () => {
  const synced = simulate(plan())
  synced.variants![0].options![0].value = "чёрный"
  expect(() => plan([synced])).toThrow("option labels were changed")
  const sku = plan().actions[0].create[0].sku
  expect(() => plan([product(), { id: "other", title: "Other", variants: [{ id: "other-variant", title: "Other", sku }] }])).toThrow("generated SKU")
})
it("changes the approval digest when either the target price or source price changes", () => {
  const original = plan().sha256
  const changed = product()
  changed.variants![0].price_set!.prices![0].amount = 4000
  expect(plan([changed]).sha256).not.toBe(original)
  const data = offers()
  data.offers[0].prices[0].amount = "5600"
  expect(plan([product()], data).sha256).not.toBe(original)
})
it("uses only the approved narrow workflow payloads and stops on failure", async () => {
  const operations = { updateOption: jest.fn().mockResolvedValue(null), batchVariants: jest.fn().mockResolvedValue(null), updateProduct: jest.fn().mockResolvedValue(null) }
  const result = plan()
  await applyCatalogPlan(result, operations)
  expect(operations.batchVariants.mock.calls[0][0]).toEqual({ create: result.actions[0].create, update: result.actions[0].update })
  expect(operations.updateOption.mock.calls[0][0]).toEqual({ ...result.actions[0].optionUpdates[0], productId: "product" })
  expect(operations.updateProduct.mock.calls[0][0]).toEqual({ id: "product", metadata: result.actions[0].metadata })
  operations.batchVariants.mockRejectedValue(new Error("fixture failure"))
  operations.updateProduct.mockClear()
  await expect(applyCatalogPlan(result, operations)).rejects.toThrow("fixture failure")
  expect(operations.updateProduct).not.toHaveBeenCalled()
})
