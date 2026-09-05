# Mario Mikke Storefront

Full-stack e-commerce application for a clothing brand, built with **Next.js** and **Medusa**.

The project includes a custom storefront, product catalog, cart and checkout flow, backed by a production Medusa deployment.

🌐 **[mariomikke.shop](https://www.mariomikke.shop)**

> 🚧 Currently in active development

---

## Preview

![Mario Mikke Storefront](./docs/images/preview.png)

---

## Features

* Product catalog and categories
* Product pages with variants and sizes
* Product filtering
* Shopping cart
* Checkout flow
* Product recommendations
* Responsive interface
* Medusa backend integration
* Mock data mode for static demos
* Server-side rendering and ISR

---

## Tech Stack

### Frontend

`Next.js` · `React` · `TypeScript`

### E-commerce & Backend

`Medusa` · `PostgreSQL` · `Redis` · `REST API`

### Infrastructure

`Vercel` · `Timeweb Cloud` · `Caddy` · `GitHub Actions`

### Tools

`Git` · `npm` · `Figma`

---

## Architecture

```text
                    ┌─────────────────────┐
                    │   Next.js Storefront │
                    │     Vercel + ISR     │
                    └──────────┬──────────┘
                               │
                               │ Medusa API
                               ▼
                    ┌─────────────────────┐
                    │       Medusa         │
                    │   Timeweb Cloud      │
                    └──────────┬──────────┘
                               │
                     ┌─────────┴─────────┐
                     ▼                   ▼
                PostgreSQL             Redis
```

The storefront is deployed on **Vercel** and communicates with a production
**Medusa** backend hosted on Timeweb Cloud.

Product and catalog pages use server rendering with **Incremental Static
Regeneration (ISR)**. Product pages are generated on demand and periodically
revalidated, allowing newly created products to become available without
redeploying the storefront.

The backend infrastructure uses a Timeweb Load Balancer with **Caddy**,
**PostgreSQL** and **Redis**.

---

## Environments

| Environment   | Data mode         | Build target          | Backend                        |
| ------------- | ----------------- | --------------------- | ------------------------------ |
| Local         | `mock` / `medusa` | `npm run dev`         | Local Medusa or production API |
| GitHub Pages  | `mock`            | `npm run build:pages` | None                           |
| Vercel        | `medusa`          | `npm run build`       | Production Medusa              |
| Timeweb Cloud | —                 | —                     | Medusa + PostgreSQL + Redis    |

### Production

**Storefront:** [mariomikke.shop](https://www.mariomikke.shop)

**Backend:** `api.mariomikke.shop`

---

## Rendering

The project supports two different build targets.

### Production / Vercel

```bash
npm run build
```

Uses server rendering with ISR.

Product pages are generated on the first request and periodically
revalidated, allowing products created through Medusa Admin to become
available without rebuilding the application.

Next.js image optimization is enabled for production.

### GitHub Pages Demo

```bash
npm run build:pages
```

Creates a static export using mock catalog data.

The GitHub Pages build is intended as a frontend demo and therefore
does not provide checkout functionality.

---

## Local Development

### 1. Install dependencies

```bash
npm install
```

### 2. Start PostgreSQL and Redis

```bash
cd medusa-prototype
docker compose up -d postgres redis
```

### 3. Start Medusa

From the repository root:

```bash
npm run backend:dev
```

### 4. Configure the storefront

Create `.env.local` based on `.env.template`:

```env
NEXT_PUBLIC_DATA_MODE=medusa
NEXT_PUBLIC_MEDUSA_BACKEND_URL=https://api.mariomikke.shop
NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY=pk_...
```

### 5. Start Next.js

```bash
npm run dev
```

Storefront:

`http://localhost:3000`

Medusa Admin:

`http://localhost:9000/app`

---

## Project Structure

```text
.
├── src/                 # Next.js storefront
├── public/              # Static assets
├── medusa-prototype/    # Medusa backend
├── docs/
│   └── adr/             # Architecture Decision Records
├── scripts/
└── .github/
    └── workflows/       # CI workflows
```

---

## Documentation

Architecture decisions are documented using **Architecture Decision Records (ADR)** in:

```text
docs/adr/
```

Backend deployment, HTTPS, firewall configuration and recovery procedures are documented separately inside the Medusa backend directory.

---

## Status

The project is currently under active development.

Current focus includes improving the storefront, e-commerce flows and production infrastructure.

