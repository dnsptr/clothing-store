jest.mock("@medusajs/framework/utils", () => ({ ContainerRegistrationKeys: { QUERY: "query", LOGGER: "logger" } }))
jest.mock("@medusajs/medusa/core-flows", () => ({ batchProductVariantsWorkflow: jest.fn(), setProductProductOptionsWorkflow: jest.fn(), updateProductsWorkflow: jest.fn() }))

import * as fs from "node:fs/promises"
import * as path from "node:path"
import * as os from "node:os"
import { createHash } from "node:crypto"
import type { ExecArgs } from "@medusajs/framework/types"
import { batchProductVariantsWorkflow, setProductProductOptionsWorkflow, updateProductsWorkflow } from "@medusajs/medusa/core-flows"
import syncOnecCatalog from "../sync-onec-catalog"
import { ExchangeStore } from "../../lib/onec/exchange"
import type { SyncProduct } from "../../lib/onec/sync-plan"

const original = { ...process.env }
let root: string
let snapshot: Record<string, unknown>
const run = jest.fn().mockResolvedValue({ result: {} })
const info = jest.fn()
const graph = jest.fn()
const execute = () => syncOnecCatalog({ container: { resolve: (key: string) => key === "logger" ? { info } : { graph } } } as unknown as ExecArgs)
const xml = (body: string) => Buffer.from(`<КоммерческаяИнформация ВерсияСхемы="2.08" ДатаФормирования="2026-11-24T01:00:00">${body}</КоммерческаяИнформация>`)
beforeEach(async () => {
  jest.clearAllMocks()
  for (const workflow of [batchProductVariantsWorkflow, setProductProductOptionsWorkflow, updateProductsWorkflow]) jest.mocked(workflow).mockReturnValue({ run } as never)
  root = await fs.mkdtemp(path.join(os.tmpdir(), "mm-onec-apply-"))
  Object.assign(process.env, { ONEC_EXCHANGE_ENABLED: "true", ONEC_EXCHANGE_USER: "fixture", ONEC_EXCHANGE_PASSWORD: "x".repeat(40), ONEC_EXCHANGE_STORAGE_DIR: root, ONEC_SYNC_ARTICLES: "1916" })
  delete process.env.ONEC_SYNC_APPLY
  delete process.env.ONEC_SYNC_EXPECTED_PLAN_SHA256
  delete process.env.ONEC_SYNC_BACKUP_FILE
  const store = new ExchangeStore({ enabled: true, username: "fixture", password: "x".repeat(40), root })
  await store.locked(async () => {
    const token = await store.create()
    const session = await store.authenticate(token)
    const id = createHash("sha256").update(token).digest("hex")
    Object.assign(process.env, { ONEC_SYNC_CATALOG_SESSION: id, ONEC_SYNC_OFFERS_SESSION: id })
    await store.init(session)
    await store.upload(session, "import.xml", xml('<Каталог><Ид>catalog</Ид><ИдКлассификатора>classifier</ИдКлассификатора><Товары><Товар><Ид>source</Ид><Артикул>1916</Артикул></Товар></Товары></Каталог>'))
    await store.inspect(session, "import.xml")
    await store.upload(session, "offers.xml", xml('<ПакетПредложений><ИдКаталога>catalog</ИдКаталога><ИдКлассификатора>classifier</ИдКлассификатора><ТипыЦен><ТипЦены><Ид>retail</Ид></ТипЦены></ТипыЦен><Предложения><Предложение><Ид>source#red</Ид><ХарактеристикиТовара><ХарактеристикаТовара><Наименование>Цвет</Наименование><Значение>красный</Значение></ХарактеристикаТовара><ХарактеристикаТовара><Наименование>Размер</Наименование><Значение>One size</Значение></ХарактеристикаТовара></ХарактеристикиТовара><Цены><Цена><ИдТипаЦены>retail</ИдТипаЦены><ЦенаЗаЕдиницу>5500</ЦенаЗаЕдиницу><Валюта>руб</Валюта><Коэффициент>1</Коэффициент><Единица>шт</Единица></Цена></Цены></Предложение></Предложения></ПакетПредложений>'))
    await store.inspect(session, "offers.xml")
  })
  snapshot = { id: "product", title: "Keep", status: "published", metadata: { catalog_profile: { model: "1916" } }, options: [{ id: "color", title: "Цвет", values: [{ value: "красный" }] }, { id: "size", title: "Размер", values: [{ value: "ONE SIZE" }] }], variants: [{ id: "variant", title: "Keep variant", sku: "KEEP", options: [{ option_id: "color", value: "красный" }, { option_id: "size", value: "ONE SIZE" }], price_set: { prices: [{ amount: 3990, currency_code: "rub" }] } }] }
  graph.mockImplementation(async () => ({ data: [snapshot] }))
})
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
  for (const key of Object.keys(process.env).filter(key => key.startsWith("ONEC_"))) delete process.env[key]
  Object.assign(process.env, original)
})
const approval = () => JSON.parse(String(info.mock.calls.find(call => String(call[0]).startsWith("ONEC_SYNC_PLAN "))![0]).slice("ONEC_SYNC_PLAN ".length)).approval as string
async function approveWithBackup() {
  await execute()
  const digest = approval()
  const directory = path.join(root, ".sync", "backups")
  await fs.mkdir(directory, { recursive: true })
  const backup = path.join(directory, "fixture.dump")
  await fs.writeFile(backup, Buffer.concat([Buffer.from("PGDMP"), Buffer.alloc(200)]))
  Object.assign(process.env, { ONEC_SYNC_APPLY: "true", ONEC_SYNC_EXPECTED_PLAN_SHA256: digest, ONEC_SYNC_BACKUP_FILE: backup })
  info.mockClear()
}
it("defaults to a private plan without invoking mutation workflows", async () => {
  await execute()
  expect(approval()).toMatch(/^[a-f0-9]{64}$/)
  expect(run).not.toHaveBeenCalled()
  const reports = (await fs.readdir(path.join(root, ".sync"))).filter(name => name.endsWith(".json"))
  expect(reports).toHaveLength(1)
  expect(await fs.stat(path.join(root, ".sync", reports[0])).then(stat => stat.size)).toBeGreaterThan(100)
})
it("rejects an unapproved or changed plan before mutation", async () => {
  process.env.ONEC_SYNC_APPLY = "true"
  await expect(execute()).rejects.toThrow("not approved")
  expect(run).not.toHaveBeenCalled()
  delete process.env.ONEC_SYNC_APPLY
  await approveWithBackup()
  snapshot.title = "Concurrent admin edit"
  await expect(execute()).rejects.toThrow("Plan changed")
  expect(run).not.toHaveBeenCalled()
})
it("requires a private custom-format database backup before mutation", async () => {
  await approveWithBackup()
  process.env.ONEC_SYNC_BACKUP_FILE = path.join(root, "outside.dump")
  await expect(execute()).rejects.toThrow("private database backup")
  process.env.ONEC_SYNC_BACKUP_FILE = path.join(root, ".sync", "backups", "fixture.dump")
  await fs.writeFile(process.env.ONEC_SYNC_BACKUP_FILE, Buffer.alloc(300))
  await expect(execute()).rejects.toThrow("PostgreSQL custom-format")
  expect(run).not.toHaveBeenCalled()
})
it("applies only reviewed variant and product metadata payloads", async () => {
  await approveWithBackup()
  await execute()
  expect(run).toHaveBeenCalledTimes(2)
  expect(run.mock.calls[0][0].input).toMatchObject({ create: [], update: [{ id: "variant", prices: [{ currency_code: "rub", amount: 5500 }] }] })
  expect(run.mock.calls[1][0].input.products[0]).toEqual({ id: "product", metadata: expect.objectContaining({ onec_product_id: "source" }) })
  expect(info.mock.calls.some(call => String(call[0]).startsWith("ONEC_SYNC_APPLIED "))).toBe(true)
  expect(await fs.readdir(path.join(root, ".sync"))).not.toContain("apply.lock")
})
it("links newly used values to this product even when the global option already contains them", async () => {
  const product = snapshot as SyncProduct
  product.variants![0].options![0].value = "синий"
  product.options![0].values = [{ value: "синий" }, { value: "красный" }]
  await approveWithBackup()
  await execute()
  expect(setProductProductOptionsWorkflow).toHaveBeenCalledTimes(2)
  expect(run.mock.calls[0][0].input).toEqual({ product_id: "product", update: [{ product_option_id: "color", add: [{ value: "красный" }] }] })
  expect(run.mock.calls[1][0].input).toEqual({ product_id: "product", update: [{ product_option_id: "size", add: [{ value: "ONE SIZE" }] }] })
  expect(run.mock.calls[2][0].input.create).toHaveLength(1)
  expect(run.mock.calls[2][0].input.update).toEqual([])
})
