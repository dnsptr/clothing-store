# Backend deployment

The demo backend runs from `/opt/mario-mikke` on the Timeweb Cloud server.
Docker Compose starts Medusa, PostgreSQL, Redis, Caddy, and a Cloudflare Quick
Tunnel. PostgreSQL and Redis listen only on `127.0.0.1` and are not exposed to
the internet.

## First deployment

1. Copy this directory to `/opt/mario-mikke` on the server.
2. Set `STOREFRONT_URL` and, when a domain is available, `BACKEND_HOST` and
   `PUBLIC_BACKEND_URL`.
3. Run `bash scripts/deploy.sh` as root.
4. Run the catalog import:

   ```bash
   docker exec mario-mikke-medusa-1 \
     npx medusa exec ./src/scripts/import-mario-mikke.js
   ```

5. Create an administrator with `npx medusa user` inside the Medusa container.

The generated `.env.production` contains secrets and must never be committed.

## Temporary HTTPS

Cloudflare Quick Tunnel prints a random `https://*.trycloudflare.com` address
in its logs:

```bash
docker compose --env-file .env.production -f compose.production.yml \
  logs cloudflared
```

Quick Tunnels are for demos only. Their address may change after the container
or server restarts. When the store gets a domain, point an API subdomain at the
server, remove the `cloudflared` service, change the Caddy site address to the
HTTPS hostname, and update the CORS and storefront environment variables.

## Checks

```bash
docker compose --env-file .env.production -f compose.production.yml ps
curl http://127.0.0.1:9000/health
```
