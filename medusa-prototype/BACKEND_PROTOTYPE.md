# Mario Mikke Backend Prototype

This folder contains a first Medusa backend prototype generated with `create-medusa-app`.

## Current Scope

- Medusa backend lives in `apps/backend`.
- Medusa Admin is available at `http://localhost:9000/app` while the backend is running.
- The current storefront remains the existing Next.js app in the repository root.
- PostgreSQL and Redis run in Docker with persistent local volumes.
- Initial Medusa migrations and starter seed data have been applied.

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
REDIS_URL=redis://localhost:6379
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

The import is repeatable. It replaces only products previously imported by this script and the original Medusa starter products. Manually created admin products are preserved.

The script also configures RUB as the default store currency, creates a Russian sales region, and adds inventory for every size/color variant. Russian shipping options are intentionally left for the CDEK or Yandex Delivery integration stage.

## Next Prototype Tasks

- Deploy the backend, PostgreSQL, and Redis to a temporary Node.js host.
- Decide which Russian payment provider will be implemented first.
- Decide which delivery integration will be implemented first: CDEK or Yandex Delivery.
