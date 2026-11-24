import type { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { batchProductVariantsWorkflow, setProductProductOptionsWorkflow, updateProductsWorkflow } from "@medusajs/medusa/core-flows"
import * as fs from "node:fs/promises"
import * as path from "node:path"
import { randomUUID } from "node:crypto"
import { ExchangeStore, exchangeConfig } from "../lib/onec/exchange"
import { parseCatalog, parseOffers } from "../lib/onec/preview"
import { planCatalogSync, syncDigest, type SyncProduct } from "../lib/onec/sync-plan"
import { applyCatalogPlan } from "../lib/onec/apply-plan"

export default async function syncOnecCatalog({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const config = exchangeConfig()
  if (!config.enabled) throw new Error("1C receiver is disabled")
  const articles = (process.env.ONEC_SYNC_ARTICLES ?? "").split(",").map(value => value.trim()).filter(Boolean)
  const root = path.join(config.root, ".sync")
  await fs.mkdir(root, { recursive: true, mode: 0o700 })
  let lock: fs.FileHandle
  try { lock = await fs.open(path.join(root, "apply.lock"), "wx", 0o600) }
  catch { throw new Error("1C sync is busy; inspect the sync lock before retrying") }
  try {
    const store = new ExchangeStore(config)
    const [catalogFile, offersFile] = await store.locked(async () => [
      await store.validatedFile(process.env.ONEC_SYNC_CATALOG_SESSION ?? "", process.env.ONEC_SYNC_CATALOG_FILE ?? "import.xml"),
      await store.validatedFile(process.env.ONEC_SYNC_OFFERS_SESSION ?? "", process.env.ONEC_SYNC_OFFERS_FILE ?? "offers.xml"),
    ], 1500)
    const products: SyncProduct[] = []
    for (let skip = 0; ; skip += 100) {
      if (skip >= 10_000) throw new Error("Catalog exceeds sync limit")
      const { data } = await query.graph({ entity: "product", fields: ["id", "title", "status", "metadata", "weight", "length", "width", "height", "options.id", "options.title", "options.values.value", "variants.id", "variants.title", "variants.sku", "variants.metadata", "variants.options.*", "variants.price_set.prices.*"], pagination: { skip, take: 100, order: { id: "ASC" } } })
      products.push(...data as SyncProduct[])
      if (data.length < 100) break
    }
    const sources = { catalog: catalogFile.source, offers: offersFile.source }
    const plan = planCatalogSync(parseCatalog(catalogFile.bytes), parseOffers(offersFile.bytes), products, articles)
    const approval = syncDigest({ sources, plan })
    const filename = path.join(root, `${randomUUID()}.json`)
    const report = { status: "planned", approval, sources, plan, createdAt: new Date().toISOString() }
    await fs.writeFile(filename, JSON.stringify(report, null, 2), { mode: 0o600 })
    logger.info(`ONEC_SYNC_PLAN ${JSON.stringify({ approval, summary: plan.summary, inventoryWrites: false })}`)
    if (process.env.ONEC_SYNC_APPLY !== "true") return
    if (process.env.ONEC_SYNC_EXPECTED_PLAN_SHA256 !== approval) throw new Error("Plan changed or was not approved; run preview again")
    const backup = path.resolve(process.env.ONEC_SYNC_BACKUP_FILE || ".")
    const relative = path.relative(path.join(root, "backups"), backup)
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("A private database backup under .sync/backups is required")
    const stat = await fs.lstat(backup)
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 100) throw new Error("Database backup is invalid")
    const file = await fs.open(backup, "r")
    try {
      const header = Buffer.alloc(5)
      await file.read(header, 0, 5, 0)
      if (header.toString("ascii") !== "PGDMP") throw new Error("Expected a PostgreSQL custom-format backup")
    } finally { await file.close() }
    try {
      await applyCatalogPlan(plan, {
        updateOption: option => setProductProductOptionsWorkflow(container).run({ input: { product_id: option.productId, update: [{ product_option_id: option.id, add: option.values.map(value => ({ value })) }] } }),
        batchVariants: input => batchProductVariantsWorkflow(container).run({ input }),
        updateProduct: input => updateProductsWorkflow(container).run({ input: { products: [input] } }),
      })
      await fs.writeFile(filename, JSON.stringify({ ...report, status: "applied", backup, finishedAt: new Date().toISOString() }, null, 2), { mode: 0o600 })
      logger.info(`ONEC_SYNC_APPLIED ${JSON.stringify({ summary: plan.summary, inventoryWrites: false })}`)
    } catch (error) {
      await fs.writeFile(filename, JSON.stringify({ ...report, status: "failed", backup, finishedAt: new Date().toISOString() }, null, 2), { mode: 0o600 })
      throw error
    }
  } finally { await lock.close(); await fs.unlink(path.join(root, "apply.lock")) }
}
