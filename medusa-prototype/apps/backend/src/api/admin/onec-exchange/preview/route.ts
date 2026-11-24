import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { ExchangeError, ExchangeStore, exchangeConfig } from "../../../../lib/onec/exchange"
import { buildPreview, parseCatalog, parseOffers, PreviewError, type StoreProduct } from "../../../../lib/onec/preview"
import { scopeCatalog } from "../../../../lib/onec/scope"
import { warehousePolicy } from "../../../../lib/onec/warehouses"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  res.setHeader("Cache-Control", "no-store")
  const { catalog_session, catalog_file, offers_session, offers_file } = req.query
  if (![catalog_session, offers_session].every(value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value)) || typeof catalog_file !== "string" || typeof offers_file !== "string") {
    res.status(400).json({ message: "Выберите два проверенных файла обмена" }); return
  }
  try {
    const config = exchangeConfig()
    if (!config.enabled) { res.status(409).json({ message: "Приём обмена выключен" }); return }
    const store = new ExchangeStore(config)
    const [catalog, offers] = await store.locked(async () => [await store.validatedFile(catalog_session as string, catalog_file), await store.validatedFile(offers_session as string, offers_file)], 1500)
    const parsedCatalog = parseCatalog(catalog.bytes)
    const parsedOffers = parseOffers(offers.bytes)
    const scoped = scopeCatalog(parsedCatalog, parsedOffers)
    const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
    const products: StoreProduct[] = []
    for (let skip = 0; skip < 10_000; skip += 100) {
      const { data } = await query.graph({ entity: "product", fields: ["id", "title", "status", "metadata", "options.id", "options.title", "variants.id", "variants.title", "variants.sku", "variants.metadata", "variants.options.*", "variants.price_set.prices.*"], pagination: { skip, take: 100, order: { id: "ASC" } } })
      products.push(...data as StoreProduct[])
      if (data.length < 100) {
        res.json({ ...buildPreview(scoped.catalog, scoped.offers, products), scope: scoped.scope, warehousePolicy: warehousePolicy(scoped.offers.warehouses), builtAt: new Date().toISOString(), sources: { catalog: catalog.source, offers: offers.source } })
        return
      }
    }
    res.status(422).json({ message: "Каталог превышает лимит предварительного сопоставления" })
  } catch (error) {
    if (error instanceof PreviewError) { res.status(409).json({ message: "Файлы нельзя сопоставить: проверьте, что это каталог и предложения из одного полного обмена" }); return }
    if (error instanceof ExchangeError) { res.status(error.status).json({ message: "Выбранные файлы недоступны, не проверены или изменились. Обновите журнал." }); return }
    res.status(503).json({ message: "Не удалось построить предварительный отчёт. Повторите попытку позднее." })
  }
}
