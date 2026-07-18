# Mario Mikke Backend Prototype

This folder contains a first Medusa backend prototype generated with `create-medusa-app`.

## Current Scope

- Medusa backend lives in `apps/backend`.
- Medusa Admin will be available at `http://localhost:9000/app` after the backend is connected to PostgreSQL.
- The current storefront remains the existing Next.js app in the repository root.
- Database setup was skipped during generation because PostgreSQL and Docker are not installed on this machine yet.

## Local Prerequisites

- Node.js 20+
- Docker Desktop, or a local PostgreSQL 15+ and Redis 7+ installation

## Local Run With Docker

1. Start infrastructure:

```bash
cd medusa-prototype
docker compose up -d postgres redis
```

2. Create `apps/backend/.env` from `apps/backend/.env.template` and set:

```bash
DATABASE_URL=postgres://medusa:medusa@localhost:5432/medusa_backend
REDIS_URL=redis://localhost:6379
STORE_CORS=http://localhost:3000
ADMIN_CORS=http://localhost:5173,http://localhost:9000
AUTH_CORS=http://localhost:5173,http://localhost:9000,http://localhost:3000
JWT_SECRET=replace-with-random-secret
COOKIE_SECRET=replace-with-random-secret
```

3. Run migrations and seed data from `apps/backend` once the database is available.

4. Start the backend:

```bash
npm run backend:dev
```

## Next Prototype Tasks

- Connect PostgreSQL and run Medusa migrations.
- Create the first admin user.
- Define the product import mapping from `src/data/mockData.ts`.
- Add a seed script for Mario Mikke demo products, categories, sizes, colors, and collections.
- Expose storefront API settings for the existing Next.js frontend.
- Decide which Russian payment provider will be implemented first.
- Decide which delivery integration will be implemented first: CDEK or Yandex Delivery.
