import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { inspectCommerceXml, type CommerceSummary } from "./xml";

export const ONEC_COOKIE = "mm_onec";
export const CHUNK_LIMIT = 1024 * 1024;
export const FILE_LIMIT = 8 * CHUNK_LIMIT;
const SESSION_LIMIT = 16 * CHUNK_LIMIT;
const SESSION_TTL = 2 * 60 * 60 * 1000;
const RETENTION = 3 * 24 * 60 * 60 * 1000;
const MAX_SESSIONS = 20;

type ExchangeConfig = { enabled: boolean; username: string; password: string; root: string };
type ExchangeFile = { name: string; bytes: number; status: "received" | "validated" | "invalid"; summary?: CommerceSummary; sha256?: string };
type ExchangeSession = {
  id: string; credentialVersion: string; createdAt: string; updatedAt: string;
  initialized: boolean; complete: boolean; files: ExchangeFile[];
};

export class ExchangeError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

export function exchangeConfig(env: NodeJS.ProcessEnv = process.env): ExchangeConfig {
  const enabled = env.ONEC_EXCHANGE_ENABLED === "true";
  const root = path.resolve(env.ONEC_EXCHANGE_STORAGE_DIR || path.join(process.cwd(), "var/onec"));
  for (const publicDir of ["static", "public"]) {
    const relative = path.relative(path.resolve(publicDir), root);
    if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) throw new ExchangeError("Unsafe exchange storage", 503);
  }
  const username = env.ONEC_EXCHANGE_USER || "";
  const password = env.ONEC_EXCHANGE_PASSWORD || "";
  if (enabled && (!username || username.includes(":") || password.length < 32)) throw new ExchangeError("Exchange credentials are not configured", 503);
  return { enabled, username, password, root };
}

function equalSecret(a: string, b: string): boolean {
  return timingSafeEqual(createHash("sha256").update(a).digest(), createHash("sha256").update(b).digest());
}

export function validBasicAuth(header: string | undefined, config: ExchangeConfig): boolean {
  if (!header || !/^Basic [A-Za-z0-9+/]+=*$/i.test(header) || header.length > 2048) return false;
  const value = Buffer.from(header.slice(6), "base64").toString("utf8");
  const colon = value.indexOf(":");
  return colon > 0 && equalSecret(value.slice(0, colon), config.username) && equalSecret(value.slice(colon + 1), config.password);
}

export function cookieToken(header: string | undefined): string {
  const matches = (header || "").split(";").map((part) => part.trim()).filter((part) => part.startsWith(ONEC_COOKIE + "="));
  if (matches.length !== 1) throw new ExchangeError("Session required", 401);
  const token = matches[0].slice(ONEC_COOKIE.length + 1);
  if (!/^[a-f0-9]{64}$/.test(token)) throw new ExchangeError("Invalid session", 401);
  return token;
}

export function safeFilename(value: unknown): string {
  if (typeof value !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,120}\.xml$/i.test(value) || value.includes("..")) {
    throw new ExchangeError("Only flat XML filenames are supported; disable image export");
  }
  return value;
}

export class ExchangeStore {
  constructor(private config: ExchangeConfig, private now = () => Date.now()) {}
  private credentialVersion() { return createHash("sha256").update(this.config.username + "\0" + this.config.password).digest("hex"); }
  private directory(id: string): string {
    if (!/^[a-f0-9]{64}$/.test(id)) throw new ExchangeError("Invalid storage identifier", 503);
    return path.join(this.config.root, id);
  }
  private async save(session: ExchangeSession): Promise<void> {
    session.updatedAt = new Date(this.now()).toISOString();
    const target = path.join(this.directory(session.id), "session.json");
    await fs.writeFile(target + ".tmp", JSON.stringify(session), { mode: 0o600 });
    await fs.rename(target + ".tmp", target);
  }
  private async read(id: string): Promise<ExchangeSession> {
    return JSON.parse(await fs.readFile(path.join(this.directory(id), "session.json"), "utf8"));
  }
  async locked<T>(action: () => Promise<T>): Promise<T> {
    await fs.mkdir(this.config.root, { recursive: true, mode: 0o700 });
    const lockPath = path.join(this.config.root, ".lock");
    let lock: fs.FileHandle;
    try { lock = await fs.open(lockPath, "wx", 0o600); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new ExchangeError("Exchange busy; retry request", 503);
      throw error;
    }
    try { return await action(); }
    finally { await lock.close(); await fs.unlink(lockPath); }
  }
  private async sessions(): Promise<ExchangeSession[]> {
    const names = await fs.readdir(this.config.root).catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return []; throw error; });
    const sessions: ExchangeSession[] = [];
    for (const name of names.filter((name) => /^[a-f0-9]{64}$/.test(name))) {
      const session = await this.read(name);
      if (this.now() - Date.parse(session.updatedAt) > RETENTION) {
        // Only generated digest-named directories inside the private spool.
        await fs.rm(this.directory(name), { recursive: true, force: true });
      } else sessions.push(session);
    }
    return sessions.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async create(): Promise<string> {
    if ((await this.sessions()).length >= MAX_SESSIONS) throw new ExchangeError("Session storage limit reached", 503);
    const token = randomBytes(32).toString("hex");
    const id = createHash("sha256").update(token).digest("hex");
    await fs.mkdir(this.directory(id), { mode: 0o700 });
    const session: ExchangeSession = { id, credentialVersion: this.credentialVersion(), createdAt: new Date(this.now()).toISOString(), updatedAt: new Date(this.now()).toISOString(), initialized: false, complete: false, files: [] };
    await this.save(session);
    return token;
  }
  async authenticate(token: string): Promise<ExchangeSession> {
    if (!/^[a-f0-9]{64}$/.test(token)) throw new ExchangeError("Invalid session", 401);
    const id = createHash("sha256").update(token).digest("hex");
    let session: ExchangeSession;
    try { session = await this.read(id); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new ExchangeError("Unknown session", 401); throw error; }
    if (!Number.isFinite(Date.parse(session.createdAt)) || this.now() - Date.parse(session.createdAt) > SESSION_TTL || session.credentialVersion !== this.credentialVersion()) {
      throw new ExchangeError("Session expired", 401);
    }
    return session;
  }
  async init(session: ExchangeSession): Promise<void> {
    if (session.complete) throw new ExchangeError("Session completed");
    // Repeated init must never discard already received chunks.
    session.initialized = true;
    await this.save(session);
  }
  async upload(session: ExchangeSession, name: string, bytes: Buffer): Promise<void> {
    safeFilename(name);
    if (!session.initialized || session.complete) throw new ExchangeError("Initialize a new session first");
    if (!bytes.length || bytes.length > CHUNK_LIMIT) throw new ExchangeError("Invalid chunk size", 413);
    let file = session.files.find((file) => file.name === name);
    if (file && file.status !== "received") throw new ExchangeError("File already checked; start a new session to resend");
    if (!file && session.files.length >= 8) throw new ExchangeError("Too many files", 413);
    if ((file?.bytes || 0) + bytes.length > FILE_LIMIT || session.files.reduce((sum, file) => sum + file.bytes, 0) + bytes.length > SESSION_LIMIT) {
      throw new ExchangeError("Storage limit exceeded", 413);
    }
    await fs.appendFile(path.join(this.directory(session.id), name), bytes, { mode: 0o600 });
    if (!file) { file = { name, bytes: 0, status: "received" }; session.files.push(file); }
    file.bytes += bytes.length;
    await this.save(session);
  }
  async inspect(session: ExchangeSession, name: string): Promise<ExchangeFile> {
    safeFilename(name);
    const file = session.files.find((file) => file.name === name);
    if (!session.initialized || !file) throw new ExchangeError("File not received");
    if (file.status === "validated") return file;
    const bytes = await fs.readFile(path.join(this.directory(session.id), name));
    if (bytes.length !== file.bytes) throw new ExchangeError("Incomplete upload; start a new session");
    try { file.summary = inspectCommerceXml(bytes); }
    catch {
      file.status = "invalid";
      await this.save(session);
      throw new ExchangeError("Invalid or unsupported CommerceML XML; see admin journal");
    }
    file.status = "validated";
    file.sha256 = createHash("sha256").update(bytes).digest("hex");
    await this.save(session);
    return file;
  }
  async complete(session: ExchangeSession): Promise<void> {
    if (!session.files.length || session.files.some((file) => file.status !== "validated")) throw new ExchangeError("Validate every received file first");
    session.complete = true;
    await this.save(session);
  }
  async journal() {
    return (await this.sessions()).map(({ id, createdAt, updatedAt, files, complete }) => ({ id, createdAt, updatedAt, complete, expired: this.now() - Date.parse(createdAt) > SESSION_TTL, mode: "dry_run" as const, files }));
  }
}
