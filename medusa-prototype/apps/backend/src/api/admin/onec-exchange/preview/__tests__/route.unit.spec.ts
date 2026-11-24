jest.mock("@medusajs/framework/utils", () => ({ ContainerRegistrationKeys: { QUERY: "query" } }))

import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import { createHash } from "node:crypto"
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ExchangeStore } from "../../../../../lib/onec/exchange"
import { GET } from "../route"

let root: string
let id: string
let query: Record<string, string>
const originalEnv = { ...process.env }
const envelope = (content: string) => Buffer.from(`<КоммерческаяИнформация ВерсияСхемы="2.08" ДатаФормирования="2026-01-01T00:00:00">${content}</КоммерческаяИнформация>`)
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "mm-onec-preview-api-"))
  Object.assign(process.env, { ONEC_EXCHANGE_ENABLED: "true", ONEC_EXCHANGE_USER: "fixture", ONEC_EXCHANGE_PASSWORD: "x".repeat(40), ONEC_EXCHANGE_STORAGE_DIR: root })
  const store = new ExchangeStore({ enabled: true, username: "fixture", password: "x".repeat(40), root })
  await store.locked(async () => {
    const token = await store.create()
    id = createHash("sha256").update(token).digest("hex")
    const session = await store.authenticate(token)
    await store.init(session)
    await store.upload(session, "import.xml", envelope('<Каталог><Ид>catalog</Ид><ИдКлассификатора>classifier</ИдКлассификатора><Товары><Товар><Ид>product</Ид><Артикул>1351</Артикул></Товар></Товары></Каталог>'))
    await store.inspect(session, "import.xml")
    await store.upload(session, "offers.xml", envelope('<ПакетПредложений><ИдКаталога>catalog</ИдКаталога><ИдКлассификатора>classifier</ИдКлассификатора><Предложения><Предложение><Ид>product</Ид></Предложение></Предложения></ПакетПредложений>'))
    await store.inspect(session, "offers.xml")
  })
  query = { catalog_session: id, catalog_file: "import.xml", offers_session: id, offers_file: "offers.xml" }
})
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
  for (const key of Object.keys(process.env).filter(key => key.startsWith("ONEC_"))) delete process.env[key]
  Object.assign(process.env, originalEnv)
})
async function run(params: unknown = query, graph = jest.fn().mockResolvedValue({ data: [] })) {
  const resolve = jest.fn().mockReturnValue({ graph })
  const res = { setHeader: jest.fn(), status: jest.fn().mockReturnThis(), json: jest.fn() }
  await GET({ query: params, scope: { resolve } } as unknown as MedusaRequest, res as unknown as MedusaResponse)
  return { res, resolve, graph, body: res.json.mock.calls[0]?.[0] }
}
it("reads validated files and the catalog through the query service only", async () => {
  const result = await run()
  expect(result.body.appliesChanges).toBe(false)
  expect(result.body.sources.catalog.sha256).toMatch(/^[a-f0-9]{64}$/)
  expect(result.body.summary.parent).toBe(1)
  expect(result.body.scope.authority).toBe("1c")
  expect(result.body.scope.expectedArticles).toHaveLength(21)
  expect(result.body.scope.missingArticles).toHaveLength(20)
  expect(result.resolve.mock.calls).toEqual([["query"]])
  expect(result.graph.mock.calls[0][0].entity).toBe("product")
})
it("rejects invalid references before querying catalog data", async () => {
  const result = await run({ ...query, catalog_session: "../escape" })
  expect(result.res.status).toHaveBeenCalledWith(400)
  expect(result.resolve).not.toHaveBeenCalled()
})
it("rejects changed files without exposing XML or storage paths", async () => {
  await fs.appendFile(path.join(root, id, "import.xml"), "tampered")
  const result = await run()
  expect(result.res.status).toHaveBeenCalledWith(409)
  expect(result.resolve).not.toHaveBeenCalled()
  expect(JSON.stringify(result.body)).not.toContain(root)
})
it("fails closed when the receiver is disabled or query service fails", async () => {
  process.env.ONEC_EXCHANGE_ENABLED = "false"
  expect((await run()).res.status).toHaveBeenCalledWith(409)
  process.env.ONEC_EXCHANGE_ENABLED = "true"
  const result = await run(query, jest.fn().mockRejectedValue(new Error("sensitive-internal-error")))
  expect(result.res.status).toHaveBeenCalledWith(503)
  expect(JSON.stringify(result.body)).not.toContain("sensitive-internal-error")
})
