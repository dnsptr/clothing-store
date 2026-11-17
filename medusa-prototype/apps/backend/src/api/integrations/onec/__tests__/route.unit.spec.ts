import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { Readable } from "node:stream";
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { CHUNK_LIMIT, exchangeConfig, ExchangeStore } from "../../../../lib/onec/exchange";
import { GET, POST } from "../route";
import { GET as journal } from "../../../admin/onec-exchange/route";

const keys = ["ONEC_EXCHANGE_ENABLED", "ONEC_EXCHANGE_USER", "ONEC_EXCHANGE_PASSWORD", "ONEC_EXCHANGE_STORAGE_DIR"] as const;
const username = "fixture-onec";
const password = "x".repeat(40);
const auth = "Basic " + Buffer.from(username + ":" + password).toString("base64");
let root: string;
let saved: Array<string | undefined>;
let requestId = 0;

beforeEach(async () => {
  saved = keys.map((key) => process.env[key]);
  root = await fs.mkdtemp(path.join(os.tmpdir(), "onec-route-"));
  Object.assign(process.env, { ONEC_EXCHANGE_ENABLED: "true", ONEC_EXCHANGE_USER: username, ONEC_EXCHANGE_PASSWORD: password, ONEC_EXCHANGE_STORAGE_DIR: root });
});
afterEach(async () => {
  keys.forEach((key, index) => { if (saved[index] === undefined) delete process.env[key]; else process.env[key] = saved[index]; });
  await fs.rm(root, { recursive: true, force: true });
});

function request(options: { type?: string; mode?: string; method?: string; filename?: string; headers?: Record<string, string>; chunks?: Buffer[] } = {}) {
  const read = jest.fn();
  const stream = Readable.from((async function* () {
    for (const chunk of options.chunks || []) { read(); yield chunk; }
  })());
  const req = Object.assign(stream, {
    query: { type: options.type || "catalog", mode: options.mode || "init", filename: options.filename || "import.xml" },
    method: options.method || "GET", headers: options.headers || {},
    socket: { remoteAddress: `isolated-onec-route-${++requestId}` }, setTimeout: jest.fn(),
  });
  return { req: req as unknown as MedusaRequest, read, timeout: req.setTimeout };
}

function response() {
  const headers = new Map<string, string>();
  const res = {
    statusCode: 200, body: undefined as unknown, headers,
    setHeader: jest.fn((name: string, value: string) => headers.set(name, value)),
    type: jest.fn((value: string) => { headers.set("Content-Type", value); return res; }),
    status: jest.fn((value: number) => { res.statusCode = value; return res; }),
    send: jest.fn((value: string) => { res.body = value; return res; }),
    json: jest.fn((value: unknown) => { res.body = value; return res; }),
  };
  return res;
}

async function invoke(input: { req: MedusaRequest }) {
  const res = response();
  await (input.req.method === "POST" ? POST : GET)(input.req, res as unknown as MedusaResponse);
  return res;
}

async function session() {
  const store = new ExchangeStore(exchangeConfig());
  const token = await store.locked(async () => {
    const token = await store.create();
    await store.init(await store.authenticate(token));
    return token;
  });
  return { store, token, cookie: `mm_onec=${token}` };
}

it("challenges exchange credentials and creates a private session with a hardened cookie", async () => {
  const denied = await invoke(request({ mode: "checkauth" }));
  expect(denied.statusCode).toBe(401);
  expect(denied.headers.get("WWW-Authenticate")).toBe('Basic realm="1C catalog exchange"');
  expect(await fs.readdir(root)).toEqual([]);
  const accepted = await invoke(request({ mode: "checkauth", headers: { authorization: auth } }));
  expect(accepted.statusCode).toBe(200);
  const lines = String(accepted.body).trim().split("\n");
  expect(lines).toEqual(["success", "mm_onec", expect.stringMatching(/^[a-f0-9]{64}$/)]);
  expect(accepted.headers.get("Set-Cookie")).toBe(`mm_onec=${lines[2]}; Path=/integrations/onec; HttpOnly; Secure; SameSite=Strict; Max-Age=7200`);
  expect(accepted.headers.get("Cache-Control")).toBe("no-store");
  const persisted = await new ExchangeStore(exchangeConfig()).authenticate(lines[2]);
  expect(persisted.id).toBe(createHash("sha256").update(lines[2]).digest("hex"));
  expect(persisted.credentialVersion).toBe(createHash("sha256").update(username + "\0" + password).digest("hex"));
});

it("rejects unauthenticated uploads before consuming bytes or touching the spool", async () => {
  const input = request({ mode: "file", method: "POST", chunks: [Buffer.from("private XML")] });
  expect((await invoke(input)).statusCode).toBe(401);
  expect(input.read).not.toHaveBeenCalled();
  expect(await fs.readdir(root)).toEqual([]);
});

it.each([
  { type: "sale", mode: "query", method: "GET", status: 400 },
  { mode: "unknown", method: "GET", status: 400 },
  { mode: "checkauth", method: "POST", status: 405 },
  { mode: "file", method: "GET", status: 405 },
  { mode: "init", method: "POST", status: 405 },
])("rejects unsupported protocol requests: $mode/$method", async ({ status, ...options }) => {
  const res = await invoke(request(options));
  expect(res.statusCode).toBe(status);
  expect(res.body).toMatch(/^failure\n/);
});

it.each(["../import.xml", "photo.jpg"])("rejects filename %s before consuming an upload", async (filename) => {
  const { cookie } = await session();
  const input = request({ mode: "file", method: "POST", filename, headers: { cookie }, chunks: [Buffer.from("private XML")] });
  expect((await invoke(input)).statusCode).toBe(400);
  expect(input.read).not.toHaveBeenCalled();
});

it.each<{ headers: Record<string, string>; status: number }>([
  { headers: { "content-encoding": "gzip" }, status: 400 },
  { headers: { "content-length": String(CHUNK_LIMIT + 1) }, status: 413 },
])("rejects unsupported upload headers before consuming bytes: $status", async ({ headers, status }) => {
  const { cookie } = await session();
  const input = request({ mode: "file", method: "POST", headers: { ...headers, cookie }, chunks: [Buffer.from("private XML")] });
  expect((await invoke(input)).statusCode).toBe(status);
  expect(input.read).not.toHaveBeenCalled();
});

it("enforces the actual streamed byte limit and resets the upload timeout on rejection", async () => {
  const { cookie, store } = await session();
  const input = request({ mode: "file", method: "POST", headers: { cookie, "content-length": "1" }, chunks: [Buffer.alloc(CHUNK_LIMIT), Buffer.from("x")] });
  expect((await invoke(input)).statusCode).toBe(413);
  expect(input.timeout).toHaveBeenLastCalledWith(0);
  expect((await store.journal())[0].files).toEqual([]);
});

it("reports XML validation failures without exposing uploaded XML", async () => {
  const { cookie, store } = await session();
  await invoke(request({ mode: "file", method: "POST", headers: { cookie }, chunks: [Buffer.from("<private-invalid/>")] }));
  const rejected = await invoke(request({ mode: "import", headers: { cookie } }));
  expect(rejected.statusCode).toBe(400);
  expect(rejected.body).toMatch(/^failure\n/);
  expect(rejected.body).not.toContain("private-invalid");
  expect((await store.journal())[0].files[0].status).toBe("invalid");
});

it("fails closed when disabled and preserves the disabled Admin response contract", async () => {
  process.env.ONEC_EXCHANGE_ENABLED = "false";
  expect((await invoke(request({ mode: "checkauth", headers: { authorization: auth } }))).statusCode).toBe(503);
  const res = response();
  // Authentication is exercised by the native Medusa HTTP regression, not this direct handler call.
  await journal(request().req, res as unknown as MedusaResponse);
  expect(res.body).toEqual({ enabled: false, mode: "dry_run", sessions: [] });
  expect(await fs.readdir(root)).toEqual([]);
});

it("redacts storage errors in both transport and Admin responses", async () => {
  await fs.rm(root, { recursive: true });
  await fs.writeFile(root, "not a directory");
  const transport = await invoke(request({ mode: "checkauth", headers: { authorization: auth } }));
  expect(transport.statusCode).toBe(503);
  expect(transport.body).toBe("failure\nExchange storage unavailable\n");
  const admin = response();
  await journal(request().req, admin as unknown as MedusaResponse);
  expect(admin.statusCode).toBe(503);
  expect(JSON.stringify(admin.body)).not.toContain(root);
});
