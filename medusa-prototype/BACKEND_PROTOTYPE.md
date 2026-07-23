# Mario Mikke Backend Prototype

This folder contains a first Medusa backend prototype generated with `create-medusa-app`.

## Current Scope

- Medusa backend lives in `apps/backend`.
- Medusa Admin is available at `http://localhost:9000/app` while the backend is running.
- The current storefront remains the existing Next.js app in the repository root.
- PostgreSQL and Redis run in Docker with persistent local volumes.
- Initial Medusa migrations and starter seed data have been applied.

## Redis Infrastructure Modules

- `medusa-config.ts` registers the Redis-backed Event Bus, Workflow Engine, Cache, and Locking (Redis provider, set as default) modules, all driven by `REDIS_URL`.
- This replaces Medusa's in-memory defaults (the "Local Event Bus" and in-memory locking), which lose queued events on restart and race under concurrent operations.
- `REDIS_URL` is now **required in production**: the config throws a clear error when `NODE_ENV=production` and `REDIS_URL` is unset.
- In development the Redis modules are only registered when `REDIS_URL` is present; without it the backend still boots on the in-memory defaults.

## Local Prerequisites

- Node.js 20+
- Docker Desktop, or a local PostgreSQL 15+ and Redis 7+ installation

## Local Run With Docker

1. Install dependencies:

```bash
cd medusa-prototype
npm ci
```

2. Start infrastructure:

```bash
docker compose up -d postgres redis
```

PostgreSQL uses host port `5433` to avoid conflicting with a native PostgreSQL installation on `5432`.

3. Create `apps/backend/.env` from `apps/backend/.env.template` and set:

```bash
DATABASE_URL=postgres://medusa:medusa@localhost:5433/medusa_backend
REDIS_URL=redis://:medusa@localhost:6379
STORE_CORS=http://localhost:3000
ADMIN_CORS=http://localhost:5173,http://localhost:9000
AUTH_CORS=http://localhost:5173,http://localhost:9000,http://localhost:3000
JWT_SECRET=replace-with-random-secret
COOKIE_SECRET=replace-with-random-secret
```

4. Apply migrations from `apps/backend`:

```bash
cd apps/backend
npm exec -- medusa db:migrate
```

5. Create a local admin user:

```bash
npm exec -- medusa user -e admin@example.com -p "replace-with-a-local-password"
```

6. Start the backend from the prototype root:

```bash
cd ../..
npm run backend:dev
```

The backend health endpoint is `http://localhost:9000/health`. Stop the containers with `docker compose stop` when they are not needed.

## Demo Catalog

Import or refresh the Mario Mikke demo catalog from the repository root:

```bash
npm run backend:catalog
```

The import is repeatable: catalog products are upserted by `handle`/`sku`
(IMPORT-001), so re-running it preserves Medusa product/variant IDs and existing
stock levels. Manually created admin products are preserved. See
`DEPLOYMENT.md` → «Re-running the catalog import» for the details.

The script also configures RUB as the default store currency, creates a Russian sales region, and adds inventory for every size/color variant. Russian shipping options are intentionally left for the CDEK or Yandex Delivery integration stage.

## Tax & Pricing (RU: НДС 5%, tax-inclusive)

Per ADR-001 §2 the backend is the single source of truth for prices, taxes, and
totals, and every catalog price is entered and stored **with VAT (gross /
tax-inclusive)**.

- **Rate.** The RU tax region has one default rate — name «НДС 5%», code `vat5`,
  `rate: 5`, `is_default: true` — provisioned idempotently by
  `src/migration-scripts/initial-data-seed.ts` (re-running the seed does not
  create a second rate). The region's `automatic_taxes` is `true` (the Medusa
  Region-module default, set explicitly), so tax lines are computed
  automatically.
- **Tax-inclusive.** In Medusa 2.17 tax-inclusivity is a Pricing-module *price
  preference* (`attribute` + `value` + `is_tax_inclusive`), not a per-price
  flag. The seed marks the `rub` store currency `is_tax_inclusive: true`, which
  upserts a `currency_code = rub` price preference; the catalog import
  re-asserts the same flag.
- **Calculation.** Medusa derives the tax portion from the gross amount as
  `gross × 5 / 105`, rounded to the kopeck. Example: a 4900 ₽ item ⇒
  `tax_total = 4900 × 5 / 105 = 233.33 ₽`, while the line/item total stays
  **4900 ₽** (it is *not* 4900 + 245 = 5145).
- **Frontend.** The storefront renders `item.total` / `cart.tax_total` from the
  Store API as-is; it must never add or recompute VAT.

## Next Prototype Tasks

- Deploy the backend, PostgreSQL, and Redis to a temporary Node.js host.
- Decide which Russian payment provider will be implemented first.
- Decide which delivery integration will be implemented first: CDEK or Yandex Delivery.
