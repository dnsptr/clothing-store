import { LEGACY_VARIANT_MIGRATIONS } from "../legacy-migrations"
import { planCatalogSync, type SyncProduct } from "../sync-plan"
import type { parseCatalog, parseOffers } from "../preview"

function fixture(migration: typeof LEGACY_VARIANT_MIGRATIONS[number] = LEGACY_VARIANT_MIGRATIONS[0]) {
  const sourceId = migration.offerId.split("#")[0]
  const catalog: ReturnType<typeof parseCatalog> = { catalogId: "catalog", classifierId: "classifier", generatedAt: "2026-11-24T01:00:00", products: [{ id: sourceId, article: migration.article, name: "Source" }] }
  const offers: ReturnType<typeof parseOffers> = { catalogId: "catalog", classifierId: "classifier", generatedAt: catalog.generatedAt, priceTypes: [{ id: "retail", name: "Retail", currency: "rub" }], warehouses: [], offers: [{ id: migration.offerId, name: "Source", article: migration.article, totalQuantity: "0", properties: [{ name: "Цвет", value: migration.sourceColor }, { name: "Размер", value: "One size" }], prices: [{ typeId: "retail", amount: "5500", currency: "rub", factor: "1", unit: "шт" }], stocks: [] }] }
  const product: SyncProduct = { id: "product", title: "Keep title", metadata: { catalog_profile: { model: migration.article } }, options: [{ id: "color", title: "Цвет", values: [{ value: migration.color }] }, { id: "size", title: "Размер", values: [{ value: "ONE SIZE" }] }], variants: [{ id: "keep-id", title: "Keep variant title", sku: migration.sku, options: [{ option_id: "color", value: migration.color }, { option_id: "size", value: "ONE SIZE" }], price_set: { prices: [{ currency_code: "rub", amount: 3990 }] } }] }
  return { catalog, offers, product, run: () => planCatalogSync(catalog, offers, [product], [migration.article]) }
}

it.each(LEGACY_VARIANT_MIGRATIONS)("preserves $sku using its reviewed exact source ID", migration => {
  const { run } = fixture(migration)
  const action = run().actions[0]
  expect(action.create).toEqual([])
  expect(action.links[0]).toMatchObject({ variantId: "keep-id", sku: migration.sku, offerId: migration.offerId, color: migration.color })
  expect(action.update[0].metadata).toMatchObject({ onec_color: migration.sourceColor, onec_display_color: migration.color })
  expect(action.untouchedVariantIds).toEqual([])
  expect(action.migrations).toHaveLength(1)
})
it("does not merge distinct source IDs that have identical labels", () => {
  const { offers, run } = fixture()
  offers.offers.push({ ...offers.offers[0], id: offers.offers[0].id.split("#")[0] + "#different-id" })
  const action = run().actions[0]
  expect(action.create).toHaveLength(1)
  expect(action.links).toHaveLength(2)
  expect(new Set(action.links.map(link => link.offerId)).size).toBe(2)
})
it("does not turn the reviewed spellings into a global fuzzy matching rule", () => {
  const { product, run } = fixture()
  product.variants![0].sku = "UNREVIEWED-SKU"
  expect(run().actions[0].untouchedVariantIds).toEqual(["keep-id"])
  expect(run().actions[0].create).toHaveLength(1)
})
it("rejects changed source labels, changed target labels and conflicting saved bindings", () => {
  const a = fixture(); a.offers.offers[0].properties[0].value = "Другой цвет"
  expect(a.run).toThrow("migration source changed")
  const b = fixture(); b.product.variants![0].options![0].value = "Другой цвет"
  expect(b.run).toThrow("migration label changed")
  const c = fixture(); c.product.variants![0].metadata = { onec_offer_id: "other-source#id" }
  expect(c.run).toThrow("migration conflicts")
})
it("never guesses a binding for the unresolved dark-chocolate SKU", () => {
  expect(LEGACY_VARIANT_MIGRATIONS.some(migration => String(migration.sku) === "MM-1351-OS-15")).toBe(false)
  expect(new Set(LEGACY_VARIANT_MIGRATIONS.map(migration => migration.sku)).size).toBe(14)
})
