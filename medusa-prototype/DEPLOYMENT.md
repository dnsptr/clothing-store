# Backend deployment

The demo backend runs from `/opt/mario-mikke` on the Timeweb Cloud server.
Docker Compose starts Medusa, PostgreSQL, Redis, Caddy, and a daily PostgreSQL
backup job. PostgreSQL and Redis listen only on `127.0.0.1` and are not exposed
to the internet. Caddy terminates HTTPS with a Let's Encrypt certificate that is
issued automatically the first time it starts.

## Prerequisites

- A public hostname that resolves to the server. An `<SERVER-IP>.sslip.io`
  name is enough for demos because it satisfies the Let's Encrypt HTTP-01
  challenge over port 80; a real domain works the same way.
- TCP ports `80` and `443` must be open to the internet so Caddy can obtain and
  serve the certificate. Port `9000` (Medusa) must stay closed — see Firewall.

## Firewall

Medusa runs with `network_mode: host`, so its port `9000` is bound directly on
the host. Without a firewall it is reachable from the internet, which bypasses
Caddy, HTTPS, and the admin basic auth. Configure the host firewall before the
first deployment:

```bash
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw deny 9000/tcp
ufw enable
```

Only SSH and the Caddy HTTP/HTTPS ports stay open; all public traffic reaches
Medusa through Caddy.

## First deployment

1. Copy this directory to `/opt/mario-mikke` on the server.
2. Configure the firewall (see Firewall above).
3. Export the required deployment variables. `BACKEND_HOST` and `STOREFRONT_URL`
   are mandatory; `deploy.sh` refuses to run without them. `STOREFRONT_URL` is
   also embedded into product image URLs by the catalog import — a `localhost`
   value in production will cause the import script to abort:

   ```bash
   export BACKEND_HOST=<SERVER-IP>.sslip.io   # or your domain
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

Caddy serves `https://<BACKEND_HOST>` and requests a Let's Encrypt certificate
automatically on first start. This requires ports `80` and `443` to be open
(see Firewall) and `BACKEND_HOST` to resolve to the server. Point the storefront
and CORS variables at the `https://` backend URL:

- `PUBLIC_BACKEND_URL=https://<SERVER-IP>.sslip.io`
- `ADMIN_CORS=https://<SERVER-IP>.sslip.io`
- `AUTH_CORS=https://your-storefront.vercel.app,https://<SERVER-IP>.sslip.io`

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
```
