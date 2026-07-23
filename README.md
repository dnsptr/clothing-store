# Mario Mikke Storefront

The repository contains the Mario Mikke Next.js storefront and a Medusa backend prototype.

## Environments

| Environment | Data mode | Backend |
| --- | --- | --- |
| Local storefront | `mock` or `medusa` from `.env.local` | Local Medusa or the public Timeweb endpoint |
| GitHub Pages | `mock` demo | None; checkout is unavailable |
| Vercel | `medusa` at `https://www.mariomikke.shop` | `https://api.mariomikke.shop` |
| Timeweb Cloud | Medusa production | Load Balancer, Caddy, PostgreSQL, Redis, and daily backups |

The stable backend endpoint is `https://api.mariomikke.shop`. A Timeweb Load
Balancer terminates HTTPS and forwards requests to Caddy on the backend server.
Public `NEXT_PUBLIC_*` variables are embedded during the storefront build, so
changing the backend URL also requires a new Vercel deployment.

Backend deployment, firewall, HTTPS, and recovery procedures are documented in
[`medusa-prototype/DEPLOYMENT.md`](medusa-prototype/DEPLOYMENT.md).

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
