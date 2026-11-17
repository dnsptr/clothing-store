import { createServer, type Server } from "node:http"
import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { GET, POST } from "../route"
import { GET as journal } from "../../../admin/onec-exchange/route"

let server: Server
let base: string
let root: string
const originalEnv = { ...process.env }
const auth = "Basic " + Buffer.from("fixture-onec:" + "x".repeat(40)).toString("base64")
const xml = '<КоммерческаяИнформация ВерсияСхемы="2.08"><ПакетПредложений><Предложения><Предложение><Ид>fixture-product#fixture-size</Ид></Предложение></Предложения></ПакетПредложений></КоммерческаяИнформация>'
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "mm-onec-http-"))
  process.env.ONEC_EXCHANGE_ENABLED = "true"
  process.env.ONEC_EXCHANGE_USER = "fixture-onec"
  process.env.ONEC_EXCHANGE_PASSWORD = "x".repeat(40)
  process.env.ONEC_EXCHANGE_STORAGE_DIR = root
  server = createServer((request, response) => {
    const url = new URL(request.url!, "http://localhost")
    const req = Object.assign(request, { query: Object.fromEntries(url.searchParams) }) as unknown as MedusaRequest
    const res = Object.assign(response, {
      type(value: string) { response.setHeader("Content-Type", value); return this },
      status(value: number) { response.statusCode = value; return this },
      send(value: string) { response.end(value); return this },
      json(value: unknown) { response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify(value)); return this },
    }) as unknown as MedusaResponse
    void (url.pathname === "/admin/onec-exchange" ? journal(req, res) : request.method === "POST" ? POST(req, res) : GET(req, res))
  })
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve))
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
})
afterEach(async () => {
  server.closeAllConnections()
  await new Promise<void>(resolve => server.close(() => resolve()))
  await fs.rm(root, { recursive: true, force: true })
  for (const key of Object.keys(process.env).filter(key => key.startsWith("ONEC_"))) delete process.env[key]
  Object.assign(process.env, originalEnv)
})
async function request(mode: string, cookie = "", body?: string, extra = "") {
  return fetch(`${base}/integrations/onec?type=catalog&mode=${mode}${extra}`, { method: body === undefined ? "GET" : "POST", headers: { cookie, ...(mode === "checkauth" ? { authorization: auth } : {}), "content-type": "application/xml" }, body })
}
async function login() {
  const response = await request("checkauth")
  const lines = (await response.text()).trim().split("\n")
  expect(lines[0]).toBe("success")
  expect(response.headers.get("set-cookie")).toContain("HttpOnly; Secure")
  return `${lines[1]}=${lines[2]}`
}
it("implements the complete raw HTTP handshake and dry-run file flow", async () => {
  const unauthenticated = await fetch(base + "/integrations/onec?type=catalog&mode=checkauth")
  expect(unauthenticated.status).toBe(401)
  const cookie = await login()
  expect(await (await request("init", cookie)).text()).toBe("zip=no\nfile_limit=1048576\n")
  const bytes = Buffer.from(xml)
  for (const chunk of [bytes.subarray(0, 31), bytes.subarray(31)]) {
    const response = await fetch(base + "/integrations/onec?type=catalog&mode=file&filename=offers.xml", { method: "POST", headers: { cookie, "content-type": "application/octet-stream" }, body: chunk })
    expect(await response.text()).toBe("success\n")
  }
  for (let attempt = 0; attempt < 2; attempt++) expect(await (await request("import", cookie, undefined, "&filename=offers.xml")).text()).toBe("success\n")
  expect(await (await request("complete", cookie)).text()).toBe("success\n")
  const result = await (await fetch(base + "/admin/onec-exchange")).json()
  expect(result.mode).toBe("dry_run")
  expect(result.sessions[0].files[0].summary.offers).toBe(1)
  expect(JSON.stringify(result)).not.toContain(cookie.split("=")[1])
})
it("rejects unauthenticated writes, traversal, invalid XML, and order exchange", async () => {
  expect((await request("file", "", xml, "&filename=import.xml")).status).toBe(401)
  const cookie = await login()
  await request("init", cookie)
  expect((await request("file", cookie, xml, "&filename=..%2Fimport.xml")).status).toBe(400)
  expect((await request("file", cookie, xml, "&filename=photo.jpg")).status).toBe(400)
  await request("file", cookie, "<broken>", "&filename=import.xml")
  const invalid = await request("import", cookie, undefined, "&filename=import.xml")
  expect(invalid.status).toBe(400)
  expect(await invalid.text()).toMatch(/^failure\n/)
  expect((await fetch(base + "/integrations/onec?type=sale&mode=query", { headers: { cookie } })).status).toBe(400)
})
it("fails closed when disabled and rejects oversized chunks", async () => {
  const cookie = await login()
  await request("init", cookie)
  expect((await request("file", cookie, "x".repeat(1024 * 1024 + 1), "&filename=import.xml")).status).toBe(413)
  process.env.ONEC_EXCHANGE_ENABLED = "false"
  expect((await request("init", cookie)).status).toBe(503)
  const result = await (await fetch(base + "/admin/onec-exchange")).json()
  expect(result).toEqual({ enabled: false, mode: "dry_run", sessions: [] })
})
