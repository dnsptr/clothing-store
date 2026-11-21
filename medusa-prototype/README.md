<p align="center">
  <a href="https://www.medusajs.com">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://user-images.githubusercontent.com/59018053/229103275-b5e482bb-4601-46e6-8142-244f531cebdb.svg">
    <source media="(prefers-color-scheme: light)" srcset="https://user-images.githubusercontent.com/59018053/229103726-e5b529a3-9b3f-4970-8a1f-c6af37f087bf.svg">
    <img alt="Medusa logo" src="https://user-images.githubusercontent.com/59018053/229103726-e5b529a3-9b3f-4970-8a1f-c6af37f087bf.svg">
    </picture>
  </a>
</p>
<h1 align="center">
  Medusa DTC Starter
</h1>

<h4 align="center">
  <a href="https://docs.medusajs.com">Documentation</a> |
  <a href="https://www.medusajs.com">Website</a>
</h4>

<p align="center">
  Building blocks for digital commerce
</p>
<p align="center">
  <a href="https://github.com/medusajs/medusa/blob/develop/LICENSE">
    <img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="Medusa is released under the MIT license." />
  </a>
  <a href="https://circleci.com/gh/medusajs/medusa">
    <img src="https://circleci.com/gh/medusajs/medusa.svg?style=shield" alt="Current CircleCI build status." />
  </a>
  <a href="https://github.com/medusajs/medusa/blob/develop/CONTRIBUTING.md">
    <img src="https://img.shields.io/badge/PRs-welcome-brightgreen.svg?style=flat" alt="PRs welcome!" />
  </a>
    <a href="https://www.producthunt.com/posts/medusa"><img src="https://img.shields.io/badge/Product%20Hunt-%231%20Product%20of%20the%20Day-%23DA552E" alt="Product Hunt"></a>
  <a href="https://discord.gg/xpCwq3Kfn8">
    <img src="https://img.shields.io/badge/chat-on%20discord-7289DA.svg" alt="Discord Chat" />
  </a>
  <a href="https://twitter.com/intent/follow?screen_name=medusajs">
    <img src="https://img.shields.io/twitter/follow/medusajs.svg?label=Follow%20@medusajs" alt="Follow @medusajs" />
  </a>
</p>

# Medusa DTC Starter

A production-ready monorepo starter for direct-to-consumer ecommerce stores powered by Medusa and Next.js. Includes a fully featured storefront with product browsing, cart, checkout, customer accounts, and order management.

## Features

- All of [Medusa's commerce features](https://docs.medusajs.com/resources/commerce-modules)
- Multi-region support with automatic country detection
- Product catalog with variant selection
- Cart with promotion codes
- Multi-step checkout with shipping and payment
- Customer accounts with order history and address management
- Order transfer between accounts

## Getting Started

### Deploy with Medusa Cloud

The fastest way to get started is deploying with [Medusa Cloud](https://cloud.medusajs.com):

1. [Create a Medusa Cloud account](https://cloud.medusajs.com)
2. Deploy this starter directly from your dashboard

### Local Installation

Requires Node.js **24.22.2** (`../.node-version`), npm **11.19.1**,
PostgreSQL **15+** and Redis. This workspace contains the backend; the
Next.js storefront lives at the repository root, not `apps/storefront`.

1. From the repository root, install the backend workspace from its lockfile:

```bash
cd medusa-prototype
npm ci --ignore-scripts
```

2. Copy `apps/backend/.env.template` to `apps/backend/.env`. Configure the
database, Redis and application secrets for your environment. Keep bank,
carrier and notification integrations disabled until their configuration
is complete. See [deployment configuration](DEPLOYMENT.md).

3. Back up an existing database and verify upgrades on a copy before
applying migrations. From `medusa-prototype`:

```bash
npm exec --workspace @dtc/backend -- medusa db:migrate --execute-safe-links --execute-safe-search
```

4. Create an administrator with your own email and a unique password.
List the required CLI flags with:

```bash
npm exec --workspace @dtc/backend -- medusa user --help
```

5. Start the backend:

```bash
npm run backend:dev
```

Open `http://localhost:9000/app`. Start the storefront in a separate terminal
using the [repository quickstart](../README.md#local-development).

## Configuration

Configure the storefront in the repository-root `.env.local`, using
[`../.env.template`](../.env.template). Do not copy the former starter's
Stripe or default-Denmark settings into this RUB/T-Bank storefront.

| Variable | Meaning |
| --- | --- |
| `NEXT_PUBLIC_DATA_MODE` | `medusa` for backend data; `mock` for the static demo |
| `NEXT_PUBLIC_MEDUSA_BACKEND_URL` | Backend origin reachable from the customer's browser |
| `NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY` | Publishable Store API key; never an Admin secret |
| `NEXT_PUBLIC_MEDUSA_REGION_ID` | Optional region ID; otherwise the RUB region is selected |

## Resources

- [Medusa Documentation](https://docs.medusajs.com)
- [Medusa Cloud](https://cloud.medusajs.com)
