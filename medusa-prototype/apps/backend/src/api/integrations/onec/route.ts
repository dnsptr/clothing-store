import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { CHUNK_LIMIT, cookieToken, exchangeConfig, ExchangeError, ExchangeStore, ONEC_COOKIE, safeFilename, validBasicAuth } from "../../../lib/onec/exchange";

const failures = new Map<string, { count: number; until: number }>();
function allowLogin(ip: string): boolean {
  const now = Date.now();
  for (const [key, value] of failures) if (value.until < now) failures.delete(key);
  if (!failures.has(ip) && failures.size >= 1000) return false;
  const bucket = failures.get(ip) || { count: 0, until: now + 60_000 };
  failures.set(ip, bucket);
  return ++bucket.count <= 30;
}

async function readChunk(req: MedusaRequest): Promise<Buffer> {
  if (req.headers["content-encoding"] && req.headers["content-encoding"] !== "identity") throw new ExchangeError("Compression is not supported");
  const length = Number(req.headers["content-length"]);
  if (Number.isFinite(length) && length > CHUNK_LIMIT) throw new ExchangeError("Chunk too large", 413);
  const chunks: Buffer[] = [];
  let size = 0;
  req.setTimeout(15_000, () => req.destroy());
  try {
    for await (const part of req) {
      const bytes = Buffer.isBuffer(part) ? part : Buffer.from(part);
      if ((size += bytes.length) > CHUNK_LIMIT) throw new ExchangeError("Chunk too large", 413);
      chunks.push(bytes);
    }
  } finally { req.setTimeout(0); }
  return chunks.length === 1 ? chunks[0] : Buffer.concat(chunks);
}

async function exchange(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  res.setHeader("Cache-Control", "no-store");
  res.type("text/plain; charset=utf-8");
  try {
    const config = exchangeConfig();
    if (!config.enabled) throw new ExchangeError("Exchange is disabled", 503);
    const { type, mode } = req.query;
    if (type !== "catalog") throw new ExchangeError("Only catalog dry-run is supported; disable order exchange");
    const store = new ExchangeStore(config);
    if (mode === "checkauth") {
      if (req.method !== "GET") throw new ExchangeError("GET required", 405);
      if (!allowLogin(req.socket.remoteAddress || "unknown")) throw new ExchangeError("Too many login attempts", 429);
      if (!validBasicAuth(req.headers.authorization, config)) {
        res.setHeader("WWW-Authenticate", 'Basic realm="1C catalog exchange"');
        throw new ExchangeError("Invalid exchange credentials", 401);
      }
      const token = await store.locked(() => store.create());
      res.setHeader("Set-Cookie", `${ONEC_COOKIE}=${token}; Path=/integrations/onec; HttpOnly; Secure; SameSite=Strict; Max-Age=7200`);
      res.send(`success\n${ONEC_COOKIE}\n${token}\n`);
      return;
    }
    if (!["init", "file", "import", "complete"].includes(String(mode))) throw new ExchangeError("Unsupported exchange mode");
    if (req.method !== (mode === "file" ? "POST" : "GET")) throw new ExchangeError("Invalid request method", 405);
    const token = cookieToken(req.headers.cookie);
    await store.authenticate(token);
    const name = mode === "file" || mode === "import" ? safeFilename(req.query.filename) : "";
    const chunk = mode === "file" ? await readChunk(req) : undefined;
    await store.locked(async () => {
      const session = await store.authenticate(token);
      if (mode === "init") await store.init(session);
      if (mode === "file") await store.upload(session, name, chunk!);
      if (mode === "import") await store.inspect(session, name);
      if (mode === "complete") await store.complete(session);
    });
    res.send(mode === "init" ? `zip=no\nfile_limit=${CHUNK_LIMIT}\n` : "success\n");
  } catch (error) {
    const known = error instanceof ExchangeError;
    res.status(known ? error.status : 503).send(`failure\n${known ? error.message : "Exchange storage unavailable"}\n`);
  }
}

export { exchange as GET, exchange as POST };
