import type { MedusaRequest } from "@medusajs/framework/http";

import { parseCdekEnvironment } from "./config";
import { CdekClient } from "./lib/cdek-client";

const RATE_WINDOW_MS = 60_000;
const RATE_REQUEST_LIMIT = 30;
const RATE_BUCKET_LIMIT = 2_048;
const CACHE_ENTRY_LIMIT = 256;
const CACHE_TTL_LIMIT_MS = 60_000;
const UPSTREAM_CONCURRENCY_LIMIT = 4;
const SHARED_CLIENT_BUCKET = "shared-unidentified-client";
const OVERFLOW_CLIENT_BUCKET = "shared-client-overflow";

type RateBucket = {
  count: number;
  resetAt: number;
};

type CacheEntry = {
  readonly value: unknown;
  readonly expiresAt: number;
};

type PublicCdekOperation<T> = {
  readonly key: string;
  readonly cacheTtlMs: number;
  readonly execute: () => Promise<T>;
};

export class PublicCdekGuardError extends Error {
  readonly name = "PublicCdekGuardError";

  constructor(readonly reason: "rate_limited" | "busy") {
    super(reason);
  }
}

class PublicCdekGuard {
  private readonly rateBuckets = new Map<string, RateBucket>([
    [OVERFLOW_CLIENT_BUCKET, { count: 0, resetAt: 0 }],
    [SHARED_CLIENT_BUCKET, { count: 0, resetAt: 0 }],
  ]);
  private readonly cache = new Map<string, CacheEntry>();
  private readonly inFlight = new Map<string, Promise<unknown>>();
  private activeUpstreamRequests = 0;

  checkRate(request: MedusaRequest): void {
    this.consumeRateBudget(this.clientBucket(request), Date.now());
  }

  async run<T>(operation: PublicCdekOperation<T>): Promise<T> {
    const now = Date.now();
    const cached = this.cache.get(operation.key);
    if (cached && cached.expiresAt > now) {
      return cached.value as T;
    }
    if (cached) this.cache.delete(operation.key);

    const existing = this.inFlight.get(operation.key);
    if (existing) return existing as Promise<T>;
    if (this.activeUpstreamRequests >= UPSTREAM_CONCURRENCY_LIMIT) {
      throw new PublicCdekGuardError("busy");
    }

    this.activeUpstreamRequests += 1;
    const pending = operation.execute()
      .then((value) => {
        this.storeCache(operation.key, value, operation.cacheTtlMs);
        return value;
      })
      .finally(() => {
        this.activeUpstreamRequests -= 1;
        this.inFlight.delete(operation.key);
      });
    this.inFlight.set(operation.key, pending);
    return pending;
  }

  private clientBucket(request: MedusaRequest): string {
    // Medusa/Express derives this through its one-hop trust-proxy policy. Never
    // parse forwarding headers here; an absent identity shares a strict bucket.
    const ip = request.ip;
    if (typeof ip !== "string" || ip.length === 0 || ip.length > 64) {
      return SHARED_CLIENT_BUCKET;
    }
    if (this.rateBuckets.has(ip) || this.rateBuckets.size < RATE_BUCKET_LIMIT) {
      return ip;
    }
    return OVERFLOW_CLIENT_BUCKET;
  }

  private consumeRateBudget(client: string, now: number): void {
    const current = this.rateBuckets.get(client);
    if (!current || current.resetAt <= now) {
      this.rateBuckets.set(client, { count: 1, resetAt: now + RATE_WINDOW_MS });
      return;
    }
    if (current.count >= RATE_REQUEST_LIMIT) {
      throw new PublicCdekGuardError("rate_limited");
    }
    current.count += 1;
  }

  private storeCache(key: string, value: unknown, requestedTtlMs: number): void {
    const now = Date.now();
    if (this.cache.size >= CACHE_ENTRY_LIMIT) {
      for (const [cachedKey, entry] of this.cache) {
        if (entry.expiresAt <= now) this.cache.delete(cachedKey);
      }
    }
    if (this.cache.size >= CACHE_ENTRY_LIMIT) {
      const oldestKey = this.cache.keys().next().value;
      if (typeof oldestKey === "string") this.cache.delete(oldestKey);
    }
    const ttlMs = Math.max(1, Math.min(requestedTtlMs, CACHE_TTL_LIMIT_MS));
    this.cache.set(key, { value, expiresAt: now + ttlMs });
  }
}

let sharedClient: { readonly identity: string; readonly client: CdekClient } | null = null;

export function getPublicCdekClient(): CdekClient | null {
  const configuration = parseCdekEnvironment(process.env);
  if (!configuration.enabled) return null;

  const identity = JSON.stringify(configuration.options);
  if (!sharedClient || sharedClient.identity !== identity) {
    sharedClient = { identity, client: new CdekClient(configuration.options) };
  }
  return sharedClient.client;
}

export const publicCdekGuard = new PublicCdekGuard();
