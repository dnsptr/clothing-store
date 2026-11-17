import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import { ExchangeStore, cookieToken, exchangeConfig, safeFilename, validBasicAuth, CHUNK_LIMIT } from "../exchange"
import { inspectCommerceXml } from "../xml"

const xml = Buffer.from('<?xml version="1.0" encoding="UTF-8"?><КоммерческаяИнформация xmlns="urn:1C.ru:commerceml_210" ВерсияСхемы="2.08"><Каталог><Товары><Товар><Ид>sample-1916</Ид></Товар></Товары></Каталог></КоммерческаяИнформация>')
let root: string
beforeEach(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), "mm-onec-test-")) })
afterEach(async () => { await fs.rm(root, { recursive: true, force: true }) })
const config = () => ({ enabled: true, username: "onec-test", password: "a".repeat(40), root })

it("is disabled by default and requires separate strong credentials", () => {
  expect(exchangeConfig({}).enabled).toBe(false)
  expect(() => exchangeConfig({ ONEC_EXCHANGE_ENABLED: "true" })).toThrow()
  expect(() => exchangeConfig({ ONEC_EXCHANGE_STORAGE_DIR: path.resolve("static/onec") })).toThrow()
  expect(validBasicAuth("Basic " + Buffer.from("onec-test:" + "a".repeat(40)).toString("base64"), config())).toBe(true)
  expect(validBasicAuth("Basic " + Buffer.from("onec-test:wrong").toString("base64"), config())).toBe(false)
})
it("rejects traversal, images and ambiguous cookies", () => {
  for (const name of ["../import.xml", "sub/import.xml", "x\\import.xml", "image.jpg", "session.json", "x%2fimport.xml", "x..xml"]) expect(() => safeFilename(name)).toThrow()
  expect(() => cookieToken("mm_onec=wrong")).toThrow()
  expect(() => cookieToken(`mm_onec=${"a".repeat(64)}; mm_onec=${"b".repeat(64)}`)).toThrow()
})
it("accepts split XML, keeps init idempotent and validates without catalog services", async () => {
  const store = new ExchangeStore(config())
  await store.locked(async () => {
    const token = await store.create()
    expect((await store.journal())[0].id).not.toBe(token)
    let session = await store.authenticate(token)
    await store.init(session)
    await store.upload(session, "import.xml", xml.subarray(0, 17))
    await store.init(session)
    await store.upload(session, "import.xml", xml.subarray(17))
    session = await store.authenticate(token)
    const file = await store.inspect(session, "import.xml")
    expect(file.summary?.products).toBe(1)
    expect(file.status).toBe("validated")
    expect((await store.inspect(session, "import.xml")).sha256).toBe(file.sha256)
    await expect(store.upload(session, "import.xml", xml)).rejects.toThrow()
    await store.complete(session)
    expect((await store.journal())[0].mode).toBe("dry_run")
  })
})
it("enforces initialization, chunk bounds, expiration and global write lock", async () => {
  let now = Date.now()
  const store = new ExchangeStore(config(), () => now)
  await store.locked(async () => {
    const token = await store.create()
    const session = await store.authenticate(token)
    await expect(new ExchangeStore({ ...config(), password: "b".repeat(40) }).authenticate(token)).rejects.toThrow("expired")
    await expect(store.upload(session, "import.xml", xml)).rejects.toThrow()
    await store.init(session)
    await expect(store.upload(session, "import.xml", Buffer.alloc(CHUNK_LIMIT + 1))).rejects.toThrow()
    await expect(new ExchangeStore(config()).locked(async () => {})).rejects.toThrow("busy")
    now += 3 * 60 * 60 * 1000
    await expect(store.authenticate(token)).rejects.toThrow("expired")
    now += 4 * 24 * 60 * 60 * 1000
    expect(await store.journal()).toEqual([])
  })
})
it("records invalid XML and never completes an unvalidated session", async () => {
  const store = new ExchangeStore(config())
  await store.locked(async () => {
    const session = await store.authenticate(await store.create())
    await store.init(session)
    await store.upload(session, "offers.xml", Buffer.from("<broken>"))
    await expect(store.complete(session)).rejects.toThrow()
    await expect(store.inspect(session, "offers.xml")).rejects.toThrow()
    expect((await store.journal())[0].files[0].status).toBe("invalid")
  })
})
it("rejects DTD, external entities, unsupported encodings and non-CommerceML", () => {
  for (const value of ["<html/>", "<!DOCTYPE x [<!ENTITY a SYSTEM 'file:///etc/passwd'>]><КоммерческаяИнформация ВерсияСхемы='2.08'>&a;</КоммерческаяИнформация>", "<КоммерческаяИнформация ВерсияСхемы='2.08'><x></КоммерческаяИнформация>", "<?xml version='1.0' encoding='UTF-16'?><x/>"]) expect(() => inspectCommerceXml(Buffer.from(value))).toThrow()
})
it("bounds per-file storage, file count and retained session count", async () => {
  const store = new ExchangeStore(config())
  await store.locked(async () => {
    const session = await store.authenticate(await store.create())
    await store.init(session)
    for (let i = 0; i < 8; i++) await store.upload(session, "large.xml", Buffer.alloc(CHUNK_LIMIT, 32))
    await expect(store.upload(session, "large.xml", Buffer.from("x"))).rejects.toThrow("Storage limit")
    for (let i = 1; i < 8; i++) await store.upload(session, `small${i}.xml`, xml)
    await expect(store.upload(session, "ninth.xml", xml)).rejects.toThrow("Too many files")
    for (let i = 1; i < 20; i++) await store.create()
    await expect(store.create()).rejects.toThrow("Session storage limit")
  })
})
