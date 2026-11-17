import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { exchangeConfig, ExchangeStore, safeFilename, validBasicAuth } from "../exchange";
import { inspectCommerceXml } from "../xml";

const xml = '<?xml version="1.0" encoding="UTF-8"?><КоммерческаяИнформация ВерсияСхемы="2.10"><Каталог><Товары><Товар><Ид>sku-1</Ид></Товар><Товар><Ид>sku-2</Ид></Товар></Товары></Каталог><ПакетПредложений><Предложения><Предложение/></Предложения><Склады><Склад/></Склады><ТипыЦен><ТипЦены/></ТипыЦен></ПакетПредложений></КоммерческаяИнформация>';
const expectedSummary = { version: "2.10", products: 2, offers: 1, warehouseElements: 1, priceTypes: 1 };
const password = "isolated-onec-test-password-at-least-32-characters";
const now = Date.parse("2026-11-17T00:00:00Z");
let root: string;
let store: ExchangeStore;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "onec-unit-"));
  store = new ExchangeStore(exchangeConfig({ ONEC_EXCHANGE_ENABLED: "true", ONEC_EXCHANGE_USER: "fixture", ONEC_EXCHANGE_PASSWORD: password, ONEC_EXCHANGE_STORAGE_DIR: root }), () => now);
});
afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });

it("inspects real UTF-8 and legacy Windows-1251 CommerceML documents", () => {
  expect(inspectCommerceXml(Buffer.from(xml))).toEqual(expectedSummary);
  const legacy = xml.replace("UTF-8", "windows-1251");
  const bytes = Buffer.from([...legacy].map((character) => {
    const code = character.charCodeAt(0);
    return code >= 0x410 && code <= 0x44f ? code - 0x350 : code;
  }));
  expect(inspectCommerceXml(bytes)).toEqual(expectedSummary);
});

it.each([
  '<!DOCTYPE КоммерческаяИнформация [<!ENTITY test SYSTEM "file:///etc/passwd">]>' + xml.replace(/<\?xml[^>]*>/, ""),
  xml.replace("UTF-8", "UTF-16"),
  xml.slice(0, -10),
  '<other ВерсияСхемы="2.10"/>',
  '<КоммерческаяИнформация ВерсияСхемы="2.10">' + "<x>".repeat(65) + "</x>".repeat(65) + "</КоммерческаяИнформация>",
])("rejects unsafe or malformed input before reporting an accepted catalog", (input) => {
  expect(() => inspectCommerceXml(Buffer.from(input))).toThrow();
});

it("continues a legacy server session across a deployment without discarding uploaded chunks", async () => {
  const token = "1".repeat(64);
  const id = createHash("sha256").update(token).digest("hex");
  const directory = path.join(root, id);
  const bytes = Buffer.from(xml);
  const split = 93;
  await fs.mkdir(directory);
  await fs.writeFile(path.join(directory, "import.xml"), bytes.subarray(0, split));
  await fs.writeFile(path.join(directory, "session.json"), JSON.stringify({
    id, credentialVersion: createHash("sha256").update("fixture\0" + password).digest("hex"),
    createdAt: new Date(now - 1000).toISOString(), updatedAt: new Date(now - 1000).toISOString(),
    initialized: true, complete: false, files: [{ name: "import.xml", bytes: split, status: "received" }],
  }));
  await store.locked(async () => {
    const session = await store.authenticate(token);
    await store.init(session);
    await store.upload(session, "import.xml", bytes.subarray(split));
    const checked = await store.inspect(session, "import.xml");
    expect(checked.summary).toEqual(expectedSummary);
    expect(checked.sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
    await store.complete(session);
  });
  expect(await fs.readFile(path.join(directory, "import.xml"))).toEqual(bytes);
  const reopened = new ExchangeStore(exchangeConfig({ ONEC_EXCHANGE_USER: "fixture", ONEC_EXCHANGE_PASSWORD: password, ONEC_EXCHANGE_STORAGE_DIR: root }), () => now);
  expect(await reopened.journal()).toEqual([expect.objectContaining({ id, complete: true, mode: "dry_run", files: [expect.objectContaining({ status: "validated", summary: expectedSummary })] })]);
});

it("does not let a failed XML inspection complete or overwrite an already checked upload", async () => {
  const token = await store.locked(() => store.create());
  await store.locked(async () => {
    const session = await store.authenticate(token);
    await store.init(session);
    await store.upload(session, "import.xml", Buffer.from("<invalid/>"));
    await expect(store.inspect(session, "import.xml")).rejects.toThrow();
    await expect(store.complete(session)).rejects.toThrow();
    await expect(store.upload(session, "import.xml", Buffer.from(xml))).rejects.toThrow();
  });
  expect((await store.journal())[0].files[0].status).toBe("invalid");
});

it("invalidates persisted sessions after credential rotation or their two-hour deadline", async () => {
  const token = await store.locked(() => store.create());
  const rotated = new ExchangeStore(exchangeConfig({ ONEC_EXCHANGE_USER: "fixture", ONEC_EXCHANGE_PASSWORD: password + "-rotated", ONEC_EXCHANGE_STORAGE_DIR: root }), () => now);
  const expired = new ExchangeStore(exchangeConfig({ ONEC_EXCHANGE_USER: "fixture", ONEC_EXCHANGE_PASSWORD: password, ONEC_EXCHANGE_STORAGE_DIR: root }), () => now + 2 * 60 * 60 * 1000 + 1);
  await expect(rotated.authenticate(token)).rejects.toMatchObject({ status: 401 });
  await expect(expired.authenticate(token)).rejects.toMatchObject({ status: 401 });
});

it("rejects public storage, path traversal and incorrect exchange credentials", () => {
  expect(() => exchangeConfig({ ONEC_EXCHANGE_STORAGE_DIR: path.resolve("static", "onec") })).toThrow();
  for (const name of ["../import.xml", "folder/import.xml", "..\\import.xml", "import.zip"]) expect(() => safeFilename(name)).toThrow();
  const config = exchangeConfig({ ONEC_EXCHANGE_USER: "fixture", ONEC_EXCHANGE_PASSWORD: password, ONEC_EXCHANGE_STORAGE_DIR: root });
  expect(validBasicAuth("Basic " + Buffer.from("fixture:" + password).toString("base64"), config)).toBe(true);
  expect(validBasicAuth("Basic " + Buffer.from("fixture:incorrect").toString("base64"), config)).toBe(false);
});
