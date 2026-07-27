# Mario Mikke Storefront

The repository contains the Mario Mikke Next.js storefront and a Medusa backend prototype.

## Environments

| Environment | Data mode | Build target | Backend |
| --- | --- | --- | --- |
| Local storefront | `mock` or `medusa` from `.env.local` | `npm run dev` | Local Medusa or the public Timeweb endpoint |
| GitHub Pages | `mock` demo | `npm run build:pages` (static export) | None; checkout is unavailable |
| Vercel | `medusa` at `https://www.mariomikke.shop` | `npm run build` (server + ISR) | `https://api.mariomikke.shop` |
| Timeweb Cloud | Medusa production | — | Load Balancer, Caddy, PostgreSQL, Redis, and daily backups |

## Build targets

There are two deployable artifacts and CI builds both, because a change that
satisfies one can break the other.

- `npm run build` — the Vercel artifact. Server rendering with ISR: product
  pages are generated on first request and revalidated every 5 minutes, so a
  product created in Medusa Admin gets a page without a redeploy. `next/image`
  optimisation is on; remote image hosts are allow-listed in `next.config.ts`
  from the configured backend plus `MEDIA_ALLOWED_ORIGINS`.
- `npm run build:pages` — the GitHub Pages artifact. Sets `BUILD_TARGET=pages`,
  which switches on `output: "export"`, `images.unoptimized` and the
  `basePath`/`assetPrefix` derived from the repository name. Demo only: mock
  data, no checkout.

See [`docs/adr/0002-storefront-rendering-model.md`](docs/adr/0002-storefront-rendering-model.md).

The stable backend endpoint is `https://api.mariomikke.shop`. A Timeweb Load
Balancer terminates HTTPS and forwards requests to Caddy on the backend server.

`NEXT_PUBLIC_*` variables are still embedded into the browser bundle at build
time, but server rendering now prefers the unprefixed `MEDUSA_BACKEND_URL` /
`MEDUSA_PUBLISHABLE_KEY` / `DATA_MODE`, which are read when the server process
starts. Catalog and product pages therefore survive an env change without a
bundle rebuild. Cart calls are still made by the browser and still depend on the
public values — moving them behind a route handler is a separate task.

Backend deployment, firewall, HTTPS, and recovery procedures are documented in
[`medusa-prototype/DEPLOYMENT.md`](medusa-prototype/DEPLOYMENT.md).

## Documentation

Accepted architecture decisions live in [`docs/adr/`](docs/adr). They are
numbered and effectively immutable: reversing a decision means writing the next
ADR rather than rewriting the old one.

## Local Development

1. Start PostgreSQL and Redis:

```bash
cd medusa-prototype
docker compose up -d postgres redis
```

2. Start Medusa from the repository root:

```bash
npm run backend:dev
```

3. Create `.env.local` from `.env.template`, select `medusa` mode, and set the
   public backend credentials:

```bash
NEXT_PUBLIC_DATA_MODE=medusa
NEXT_PUBLIC_MEDUSA_BACKEND_URL=https://api.mariomikke.shop
NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY=pk_...
```

4. Start the storefront:

```bash
npm run dev
```

The storefront is available at [http://localhost:3000](http://localhost:3000), and Medusa Admin is available at [http://localhost:9000/app](http://localhost:9000/app).

## Catalog Data

The storefront loads products from Medusa in `medusa` mode. The local demo
catalog is reserved for `mock` mode and static previews.

Refresh the Medusa demo catalog with:

```bash
npm run backend:catalog
```

See `medusa-prototype/BACKEND_PROTOTYPE.md` for backend setup details.
