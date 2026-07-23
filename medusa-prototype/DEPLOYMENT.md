# Backend deployment

The demo backend runs from `/opt/mario-mikke` on the Timeweb Cloud server.
Docker Compose starts Medusa, PostgreSQL, Redis, Caddy, and a daily PostgreSQL
backup job. PostgreSQL and Redis listen only on `127.0.0.1` and are not exposed
to the internet. The Timeweb Load Balancer terminates HTTPS and forwards HTTP
requests to Caddy, which protects the admin routes and proxies Medusa.

## Prerequisites

- `api.mariomikke.shop` delegated to Timeweb DNS.
- A Timeweb Load Balancer with public IP `82.97.250.147`, automatic SSL, and
  `HTTP:80 -> HTTP:80` plus `HTTPS:443 -> HTTP:80` forwarding rules.
- TCP port `80` must accept traffic from the load balancer. Port `9000`
  (Medusa) must stay closed — see Firewall.

## Firewall

Medusa runs with `network_mode: host`, so its port `9000` is bound directly on
the host. Without a firewall it is reachable from the internet, which bypasses
Caddy, HTTPS, and the admin basic auth. Configure the host firewall before the
first deployment:

```bash
ufw allow 22/tcp
ufw allow 80/tcp
ufw deny 9000/tcp
ufw enable
```

Only SSH and the Caddy HTTP origin port stay open; all public HTTPS traffic
reaches Medusa through the load balancer and Caddy. Restrict port `80` to the
load balancer network when its source range is available in the Timeweb panel.

Timeweb Cloud Firewall is a separate network layer from UFW. If a cloud
firewall group is attached to the server, its inbound allowlist must include
TCP `22` for SSH and TCP `80` for the load balancer. Port `9000` must not be
published.

## First deployment

1. Copy this directory to `/opt/mario-mikke` on the server.
2. Configure the firewall (see Firewall above).
3. Export the required deployment variables. `BACKEND_HOST` and `STOREFRONT_URL`
   are mandatory; `deploy.sh` refuses to run without them. `STOREFRONT_URL` is
   also embedded into product image URLs by the catalog import — a `localhost`
   value in production will cause the import script to abort:

   ```bash
   export BACKEND_HOST=api.mariomikke.shop
   export STOREFRONT_URL=https://your-storefront.vercel.app
   ```

4. Run `bash scripts/deploy.sh` as root. On the first run it generates
   `.env.production` with fresh secrets and starts the stack. Caddy will not
   start until you set the admin hash (next step).
5. Generate the admin basic auth hash, add it to `.env.production`, and re-run
   `bash scripts/deploy.sh` (or `docker compose --env-file .env.production -f
   compose.production.yml up -d caddy`). See Admin basic auth below.
6. Run the catalog import:

   ```bash
   docker exec mario-mikke-medusa-1 \
     npx medusa exec ./src/scripts/import-mario-mikke.js
   ```

7. Create an administrator with `npx medusa user` inside the Medusa container.

The generated `.env.production` contains secrets and must never be committed.

## Re-running the catalog import

The catalog import is idempotent and safe to re-run against a populated
database. Products are matched by their `handle` (`mario-mikke-<id>`) and
variants by their `sku`; existing records are updated in place, so their Medusa
product and variant IDs — and the stock levels already set on existing
variants — are preserved. Only newly added variants receive the starting stock
level. (Re-running the import is what a future 1С sync will rely on, so the
matching keys `handle`/`sku` must stay stable — see ADR-001 §4.)

Consequences worth knowing before you re-import:

- Catalog-owned fields are overwritten from the catalog file on every run:
  product title, images, thumbnail, status, category, collection, sales channel
  and `metadata`. Edit these in `apps/backend/src/scripts/data/mario-mikke-catalog.ts`,
  not in the admin, or your admin changes will be replaced on the next import.
- Fields the catalog does not manage (for example a product `description`
  edited in the admin) are left untouched.
- Products or variants removed from the catalog file are **not** deleted
  automatically — they are left in place so their order links and stock
  survive. Pruning them is a deliberate manual action in the admin.

## HTTPS

Timeweb terminates TLS on the load balancer. The DNS record
`api.mariomikke.shop` points to `82.97.250.147`; Caddy listens on plain HTTP
port `80` behind it and forwards requests to Medusa on `127.0.0.1:9000`.
Caddy must not request its own certificate in this setup.

The production environment uses:

- `BACKEND_HOST=api.mariomikke.shop`
- `PUBLIC_BACKEND_URL=https://api.mariomikke.shop`
- `ADMIN_CORS=https://api.mariomikke.shop`
- `AUTH_CORS=https://your-storefront.vercel.app,https://api.mariomikke.shop`

After changing `NEXT_PUBLIC_MEDUSA_BACKEND_URL` in Vercel, trigger a new
deployment. The storefront uses a static export, so public environment
variables are embedded at build time.

If HTTPS fails, verify the load balancer certificate and forwarding rules first.
If the backend is marked unhealthy, verify TCP port `80`, Caddy, and
`curl -H 'Host: api.mariomikke.shop' http://127.0.0.1/health` on the server.

## Admin basic auth

Caddy protects the Medusa admin panel (`/app*`) and the admin authentication
routes (`/auth/user/*`) with HTTP basic auth. The storefront API (`/store/*`)
and customer auth (`/auth/customer/*`) stay open.

Generate a password hash with Caddy and copy the printed value into
`.env.production` as `ADMIN_BASIC_AUTH_HASH`:

```bash
docker run --rm caddy:2-alpine caddy hash-password --plaintext '<password>'
```

```bash
ADMIN_BASIC_AUTH_HASH=<hash-from-command-above>
```

Then recreate Caddy so it picks up the value:

```bash
docker compose --env-file .env.production -f compose.production.yml up -d caddy
```

The admin username is `admin`. Caddy will not start with an empty
`ADMIN_BASIC_AUTH_HASH`, so set it before the stack is fully up.

## Backups

A `pg_backup` service dumps the database once a day:

- Dumps are written to `./backups/medusa_<timestamp>.sql.gz` on the host.
- Dumps older than 7 days are removed automatically.

Restore a dump with the helper script (this overwrites the current data):

```bash
bash scripts/restore-db.sh ./backups/medusa_20260101_030000.sql.gz
```

The `./backups` directory lives only on the server disk. Syncing it to external
object storage (Amazon S3, Timeweb S3, etc.) is recommended for off-site
durability but is out of scope for this prototype.

## Checks

```bash
docker compose --env-file .env.production -f compose.production.yml ps
curl http://127.0.0.1:9000/health
curl https://api.mariomikke.shop/health
```
