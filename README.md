# Mario Mikke Storefront

The repository contains the Mario Mikke Next.js storefront and a Medusa backend prototype.

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

3. Create `.env.local` from `.env.template` and set the Medusa publishable API key.

4. Start the storefront:

```bash
npm run dev
```

The storefront is available at [http://localhost:3000](http://localhost:3000), and Medusa Admin is available at [http://localhost:9000/app](http://localhost:9000/app).

## Catalog Data

The storefront loads products from Medusa when the public environment variables are configured. If the backend is unavailable, it falls back to the local demo catalog so static previews remain usable.

Refresh the Medusa demo catalog with:

```bash
npm run backend:catalog
```

See `medusa-prototype/BACKEND_PROTOTYPE.md` for backend setup details.
