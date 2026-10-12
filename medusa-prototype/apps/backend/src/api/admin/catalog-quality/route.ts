import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { catalogQuality } from "../../../lib/catalog-quality"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const offset = Number(req.query.offset ?? 0)
  const filter = String(req.query.filter ?? "all")
  const q = String(req.query.q ?? "").trim().toLocaleLowerCase("ru")
  if (!Number.isSafeInteger(offset) || offset < 0 || !["all", "incomplete", "noPhotos", "noPrice", "noComposition", "noMeasurements"].includes(filter)) {
    res.status(400).json({ message: "Некорректный фильтр каталога" }); return
  }
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const matches: Record<string, unknown>[] = []
  // Compute quality before pagination so filters cover the whole catalog.
  for (let skip = 0; ; skip += 100) {
    const { data } = await query.graph({ entity: "product", fields: ["id", "title", "status", "metadata", "images.*", "categories.id", "variants.sku", "variants.price_set.prices.*"], pagination: { skip, take: 100, order: { id: "ASC" } } })
    for (const product of data) {
      const quality = catalogQuality({
        title: product.title, metadata: product.metadata,
        images: product.images ?? [], categories: product.categories ?? [],
        variants: product.variants?.map(variant => ({ prices: variant?.price_set?.prices?.map(price => ({ currency_code: price?.currency_code ?? "", amount: Number(price?.amount ?? 0) })) ?? [] })) ?? [],
      })
      const profile = product.metadata?.catalog_profile as Record<string, unknown> | undefined
      const search = [product.title, profile?.model, ...(product.variants ?? []).map(v => v?.sku)].join(" ").toLocaleLowerCase("ru")
      if (q && !search.includes(q)) continue
      if (filter === "incomplete" ? !quality.missing.length : filter !== "all" && !quality[filter as "noPhotos"]) continue
      matches.push({ id: product.id, title: product.title, status: product.status, ...quality })
    }
    if (data.length < 100) break
  }
  res.json({ products: matches.slice(offset, offset + 20), count: matches.length })
}
