# Mario Mikke Storefront

E-commerce storefront for **Mario Mikke**, built with **Next.js, React, TypeScript and Medusa**.

The project combines a custom Next.js storefront with a Medusa e-commerce backend and production infrastructure.

**Live:** [mariomikke.shop](https://www.mariomikke.shop)

> Currently in active development

---

## Features

* Product catalog and categories
* Product pages with variants
* Product filtering
* Shopping cart
* Checkout flow
* Product recommendations
* Responsive storefront
* Medusa API integration
* Mock catalog mode for static demos
* Server-side rendering with ISR

---

## Tech Stack

**Frontend**

`Next.js` · `React` · `TypeScript`

**Backend & Data**

`Medusa` · `PostgreSQL` · `Redis` · `REST API`

**Infrastructure**

`Vercel` · `Timeweb Cloud` · `Caddy` · `GitHub Actions`

**Tools**

`Git` · `npm` · `Figma`

---

## Architecture

```text
                    ┌─────────────────────┐
                    │  Next.js Storefront │
                    │    Vercel + ISR     │
                    └──────────┬──────────┘
                               │
                               │ Medusa API
                               ▼
                    ┌─────────────────────┐
                    │       Medusa        │
                    │   Timeweb Cloud     │
                    └──────────┬──────────┘
                               │
                     ┌─────────┴─────────┐
                     ▼                   ▼
                PostgreSQL             Redis
```

The storefront is deployed on **Vercel** and communicates with the production **Medusa** backend hosted on Timeweb Cloud.

Catalog and product pages use server rendering with **Incremental Static Regeneration (ISR)**. Product pages are generated on the first request and periodically revalidated, allowing newly created products to become available without redeploying the storefront.

The production backend uses a Timeweb Load Balancer, Caddy, PostgreSQL and Redis.

---

## Environments

| Environment   | Data mode         | Build target          | Backend                        |
| ------------- | ----------------- | --------------------- | ------------------------------ |
| Local         | `mock` / `medusa` | `npm run dev`         | Local Medusa or production API |
| GitHub Pages  | `mock`            | `npm run build:pages` | None                           |
| Vercel        | `medusa`          | `npm run build`       | Production Medusa              |
| Timeweb Cloud | —                 | —                     | Medusa + PostgreSQL + Redis    |

---

## Build Targets

The project has two deployable storefront targets.

### Production / Vercel

```bash
npm run build
```

The production build uses server rendering with ISR.

Product pages are generated on demand and periodically revalidated, allowing products created through Medusa Admin to become available without rebuilding the application.

Next.js image optimization is enabled for production.

### GitHub Pages Demo

```bash
npm run build:pages
```

Creates a static export using mock catalog data.

This build is intended as a frontend demo and does not provide checkout functionality.

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

Create `.env.local` from `.env.template`:

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

```text
http://localhost:3000
```

Medusa Admin:

```text
http://localhost:9000/app
```

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

**Active development**

The project is being actively developed. Current work focuses on improving the storefront, e-commerce flows and production infrastructure.

