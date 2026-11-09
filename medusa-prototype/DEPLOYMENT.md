# Backend deployment

The demo backend currently runs from `/opt/clothing-store/medusa-prototype` on the Timeweb Cloud server.
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

1. Copy this directory to `/opt/clothing-store/medusa-prototype` on the server.
2. Configure the firewall (see Firewall above).
3. Export the required deployment variables. `BACKEND_HOST`, `STOREFRONT_URL`
   and `HTTPS_PROXY_CIDRS` are mandatory. Obtain the actual load-balancer
   source CIDRs from the provider; its public DNS address is not evidence of
   its origin source address. Do not use `0.0.0.0/0` or `::/0`.
   `STOREFRONT_URL` is embedded into imported image URLs; a `localhost`
   value in production causes the importer to abort:

   ```bash
   export BACKEND_HOST=api.mariomikke.shop
   export STOREFRONT_URL=https://www.mariomikke.shop
   export HTTPS_PROXY_CIDRS='<verified load-balancer source CIDRs>'
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

7. Seed the home page content:

   ```bash
   docker exec mario-mikke-medusa-1 \
     npx medusa exec ./src/scripts/seed-home-content.js
   ```

   This fills the `content_slide` table with the images and texts the storefront
   used to hardcode. It is idempotent, matching on `(section, title)`, and never
   overwrites anything edited in the admin afterwards — so a re-run cannot
   revert the client's work.

8. Create an administrator with `npx medusa user` inside the Medusa container.

   If the command fails partway it can leave a user row with no credentials:
   the account then exists (a second attempt reports "already exists") but
   cannot log in. Use a different email, or delete the row, rather than
   re-running with the same address.

The generated `.env.production` contains secrets and must never be committed.

## Re-running the catalog import

The catalog importer preserves product IDs and matches variants by SKU, but
it is **not** a harmless way to apply shipping configuration to production:
it also overwrites catalog-owned fields and clears previously guessed package
dimensions when measured values are absent. Do not run it on the live store
until the catalog/1C owner confirms the dataset, a database and `./static`
backup exists, and restore has been rehearsed on an isolated database.
Importing delivery options is not proof that stores can ship orders.

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
- Shipping options are reconciled during the importer run: the legacy
  `mvp-ru` free rate and disabled carriers are removed from the storefront's
  eligible shipping list. A direct Store API bypass needs a checkout test on
  an isolated database before production.
  Yandex, CDEK and own-courier delivery options use Medusa's calculated-price
  path with explicitly configured buyer fees, not a pass-through carrier quote.
  The agreed launch fees are PVZ **350 RUB**, CDEK courier **490 RUB**,
  and Yandex PVZ **350 RUB**; both environment templates contain them.
  `CDEK_ENABLED=true` requires `CDEK_PVZ_PRICE_RUB`,
  `CDEK_COURIER_PRICE_RUB` and matching API credentials.
  `YANDEX_DELIVERY_ENABLED=true` requires `YANDEX_DELIVERY_PVZ_PRICE_RUB`,
  credentials and a confirmed dispatch station. Keep unready providers disabled.
  On 2026-10-19 the production API returned no account warehouses, but returned
  **1,747 drop-off points** with `available_for_dropoff=true` for Moscow.
  An empty warehouse list is not a self-dropoff blocker; select the actual
  accepting point used by staff, not an arbitrary buyer-only receiving PVZ.
  There is
  no default/free fallback. `/store/yandex/calculate` returns the buyer fee
  as `customer_cost`; it no longer exposes the legacy raw carrier `price`.
  Carrier quotes remain in shipping/fulfillment data as `carrier_quote_amount`
  and `carrier_quote_currency`. Do not invent buyer fees or disable measured
  parcel and pickup-point validation to make checkout pass.
- `OWN_COURIER_ENABLED=false` is the safe default. Activation requires both
  server-only DaData keys and explicit `OWN_COURIER_PRICE_RUB`. The customer
  has approved `OWN_COURIER_PRICE_RUB=0` only inside MKAD through
  **2026-12-31 inclusive, Moscow time**; other carriers remain paid.
  The server rejects zero-price eligibility from 2027-01-01 00:00 Moscow.
  No post-promotion buyer fee is invented; agree it before re-enabling delivery.
  Check real DaData eligibility in a disposable cart. Do not expose its keys.

## Coordinated release: backend and storefront

This is a release plan, not authorization to deploy or charge a card.

1. Keep checkout closed and retain prelaunch/legal notices. Confirm the real
   catalog, inventory, package measurements and multi-item packing; do not run
   the catalog importer just to change delivery fees.
2. Obtain approved legal texts, live bank/cashbox configuration, staff access
   and real SMTP/Telegram delivery. Confirm who issues the closing/refund
   receipt, offsets prepayment and scans/retires DataMatrix codes. The paid-order
   email and Medusa delivery status do not perform those cashbox actions.
   See `../docs/FISCALIZATION_ATOL_STATUS.md`; unresolved cashbox or automatic
   cancellation/refund risks block opening checkout.
3. Build and retain a matching backend image and storefront artifact from
   the same reviewed revision; provide the storefront's build-time API URL/key.
   Verify the actual Docker image on a Docker-capable host before scheduling
   production. Establish the load balancer's real `HTTPS_PROXY_CIDRS` first.
4. In a controlled window, take a fresh PostgreSQL dump and `./static` archive,
   copy both off-server, verify restoration, and preserve the current image,
   deployment/environment configuration and storefront artifact.
5. Apply backend migrations before serving the new storefront. This cutover
   includes `Migration20260926150000`, `Migration20261011100000` and
   `Migration20261011210328`; use Medusa's migration ledger rather than running
   SQL by hand. Start the new backend with carrier flags still off and confirm
   health, capability access boundaries and HTTP-to-HTTPS before admin auth.
   Legacy guest carts without an access capability must not be reused.
6. Publish the matching storefront while checkout remains closed; verify
   totals, legal DOCX download, payment return and operational access.
   Enable only verified providers. Yandex stays off until its dispatch station
   exists and the contract/API supports staff drop-off. Manually call buyers
   after assembly; no automatic second pickup-ready email is implemented.
7. Only after approval, perform the separately authorized live payment/receipt
   acceptance scenario. Reconcile bank, order, OFD/cashbox and marking results
   before opening sales. On a failed release, close checkout first. An old image
   alone is not a rollback: stop and reconcile new financial events before any
   schema downgrade or database restore; never erase a captured payment by
   restoring an older dump. Restore the coordinated application/media versions
   only under the verified rollback procedure.


## HTTPS

Timeweb terminates TLS on the load balancer. The DNS record
`api.mariomikke.shop` points to `82.97.250.147`; Caddy listens on plain HTTP
port `80` behind it and forwards requests to Medusa on `127.0.0.1:9000`.
Caddy must not request its own certificate in this setup.

The production environment uses:

- `BACKEND_HOST=api.mariomikke.shop`
- `PUBLIC_BACKEND_URL=https://api.mariomikke.shop` — also passed into the Medusa
  container, where it becomes the base of every uploaded file's URL. The backend
  refuses to boot in production without it.
- `ADMIN_CORS=https://api.mariomikke.shop`
- `STORE_CORS=https://mariomikke.shop,https://www.mariomikke.shop`
- `AUTH_CORS=https://mariomikke.shop,https://www.mariomikke.shop,https://api.mariomikke.shop`
- `HTTPS_PROXY_CIDRS` — verified source IP ranges of the HTTPS load balancer.
  Caddy rejects other origin connections, even with a forged
  `X-Forwarded-Proto: https`. Except for the public `/health` endpoint,
  trusted HTTP requests redirect to HTTPS before an admin Basic challenge.

After changing `NEXT_PUBLIC_MEDUSA_BACKEND_URL` in Vercel, trigger a new
deployment. The storefront uses a static export, so public environment
variables are embedded at build time.

If HTTPS fails, verify the load balancer certificate and forwarding rules first.
If the backend is marked unhealthy, verify TCP port `80`, Caddy, and
`curl http://127.0.0.1:9000/health` on the server, then check `/health` through
the load balancer. A direct Caddy request from outside `HTTPS_PROXY_CIDRS`
returns `403` by design; do not broaden the allowlist to make it pass.

## Admin basic auth

Caddy protects the Medusa admin panel (`/app*`) and the admin authentication
routes (`/auth/user/*`) with HTTP basic auth. Administrative API routes still
require Medusa user authentication. The public catalog and customer login
remain public; cart creation returns `cart_access_token`. Cart, payment and
guest-order requests must send that token in `x-cart-access-token`; a
publishable API key or an identifier alone does not grant access. An
authenticated customer may read only their own orders.

Uploads allow signature-checked JPEG/PNG/WebP/GIF (5 MiB per image) and
MP4/WebM (20 MiB per video), at most ten files and 20 MiB of files per request.
Caddy allows 22 MiB including multipart overhead and serves `/static/*` with
a sandbox CSP. SVG, HTML and extension/MIME mismatches are rejected.

Generate a password hash with Caddy and copy the printed value into
`.env.production` as `ADMIN_BASIC_AUTH_HASH`:

```bash
docker run --rm caddy:2-alpine caddy hash-password --plaintext '<password>'
```

**Double every `$` in the hash before writing it to the file.** Compose expands
`$VAR` inside `--env-file` values, and a bcrypt hash always looks like
`$2a$14$<salt+digest>` — the part after the third `$` is a valid variable name,
so Compose replaces it with an empty string and Caddy receives a truncated,
invalid hash. No password would ever match it. `$$` is the Compose escape for a
literal `$`:

```bash
# caddy printed: $2a$14$e4tdUXjlEnJRt3A8FnL8COX5qWWpUqV8X6uImLNbw/f65tVcyCy6i
ADMIN_BASIC_AUTH_HASH=$$2a$$14$$e4tdUXjlEnJRt3A8FnL8COX5qWWpUqV8X6uImLNbw/f65tVcyCy6i
```

Verify what the container actually receives before relying on it:

```bash
docker compose --env-file .env.production -f compose.production.yml \
  run --rm --no-deps --entrypoint sh caddy -c 'printenv ADMIN_BASIC_AUTH_HASH'
```

`scripts/deploy.sh` performs this escaping itself, so this applies only when the
hash is set by hand.

Then recreate Caddy so it picks up the value:

```bash
docker compose --env-file .env.production -f compose.production.yml up -d caddy
```

The admin username is `admin`. Caddy will not start with an empty
`ADMIN_BASIC_AUTH_HASH`, so set it before the stack is fully up.

## Backups

A `pg_backup` service dumps the database once a day:

- Dumps are written to `./backups/medusa_<timestamp>.dump.gz` on the host —
  `pg_dump -Fc` (custom format), not plain SQL.
- Each dump is verified with `pg_restore --list` before it is published, so a
  file that exists is a file that could be read back.
- Dumps older than 7 days are removed automatically, but rotation runs *only*
  after a verified success: while backups are failing, old copies are kept.

**A database dump is not a complete backup.** On 11 October 2026 the
server-side `./static` directory was empty: 36 referenced product images
instead point to `/products/` on the storefront, and 21 draft images are
placeholders. Back up both future Medusa uploads in `./static` and the
storefront's `public/products` files separately from PostgreSQL; otherwise
restoring the database can leave product cards without photos. Off-site storage
of these files and DB archives is not yet confirmed.

Restore a dump with the helper script (this overwrites the current data):

```bash
bash scripts/restore-db.sh ./backups/medusa_20260101_030000.dump.gz
```

The script exits non-zero if the restore is not complete — do not judge it by
the absence of output. Legacy `.sql.gz` dumps taken before the switch to custom
format are still accepted.

**Finish a restore with `restart medusa`, not with `deploy.sh`.** `deploy.sh`
runs `medusa db:migrate`, and that command executes *migration scripts* as well
as schema migrations — ordinary code that writes to your data. Medusa tracks
which scripts have run by file name *including the extension*
(`getPendingMigrations` compares `basename(script)`), so a script that ran as
`initial-data-seed.ts` under ts-node is a different ledger entry from the built
`initial-data-seed.js`. Restore a dump taken from such an environment and the
seed is considered pending and runs again over the restored data. In the
2026-07-27 drill it collapsed the store's `supported_currencies` from three to
one, created a duplicate stock location with its own address and links, and
inserted a tax rate. `restore-db.sh` now warns when the restored
`script_migrations` table contains `.ts` entries; check it before deploying:

```bash
docker compose --env-file .env.production -f compose.production.yml \
  exec -T postgres psql -U medusa -d medusa_backend \
  -c 'select script_name from script_migrations order by id'
```

On 11 October 2026 `medusa_20261010_154405.dump.gz` was restored with
`pg_restore --exit-on-error` in an isolated PostgreSQL 15.19 container with no
connection to the production database or services. The restored database held
21 draft products, 12 published products, two T-Bank notifications and one
payment attempt. The disposable container was removed. This confirms a
database-only restore, not restoration of storefront media or the complete
checkout. Backups still live on the same server; arrange verified off-site
copies before relying on them for disaster recovery.

## T-Bank: payment attempt without a webhook

The **local, not yet deployed** backend polls overdue payment attempts from
the scheduled `tbank-payment-reconciliation` job after 15 minutes. A
PostgreSQL lease limits parallel workers; GetState is correlated with the
saved session and attempt by terminal, payment ID, order ID and amount.
`AUTHORIZED` never means paid. A verified `CONFIRMED` bank response is
recorded on the attempt before the existing idempotent payment workflow;
no bank poll is passed off as an authenticated webhook. Failures back off,
and at most five attempts end in manual review. The current production backend
does not contain this code. Do not deploy it with live bank credentials until
the backend migration, operator process and launch prerequisites are reviewed.

The authenticated Admin API `GET /admin/tbank/manual-review` returns
`notifications` and `attempts` with separate `count` and `attempt_count`;
both use the same bounded `offset`/`limit`. The detail endpoint
`GET /admin/tbank/manual-review/:id` shows sanitized evidence for a notification
or a `tbatt_…` payment attempt. An admin may `POST .../:id/retry` or
`POST .../:id/resolve` with a nonempty JSON `reason` after checking the
bank and order; each attempt action is recorded atomically with the state
change. **Resolve only closes the investigation.** It never captures money,
creates an order, sends a cheque or issues a refund. If GetState confirmed
payment but the order is missing, arrange a manual recovery rather than
marking the attempt resolved as if the order existed.

## Checks

```bash
docker compose --env-file .env.production -f compose.production.yml ps
curl http://127.0.0.1:9000/health
curl https://api.mariomikke.shop/health
```

## SMTP: проверка реальной доставки письма

Без `SMTP_HOST`, `SMTP_USER`, `SMTP_PASSWORD` и `SMTP_FROM` Medusa использует
локальный email-провайдер: запись в журнале **не означает доставки письма**.
Production Compose передаёт эти параметры в контейнер явно; изменение одного
лишь `.env.production` без пересоздания контейнера недостаточно.

### Временный тест на личном корпоративном SMTP (без изменения production)

Реквизиты личного ящика добавьте только в игнорируемый Git файл
`apps/backend/.env.local` на своём компьютере: шесть переменных `SMTP_*`
из `apps/backend/.env.template` и `SMTP_TEST_TO` — **свой** адрес получателя.
Для ящика с двухфакторной защитой нужен разрешённый провайдером пароль
приложения. Из `apps/backend` запустите (Node 22+, PowerShell или bash):

```bash
node --env-file=.env.local -e '
const n = require("nodemailer"), e = process.env;
for (const k of ["SMTP_HOST", "SMTP_USER", "SMTP_PASSWORD", "SMTP_FROM", "SMTP_TEST_TO"]) {
  if (!e[k]) throw Error(k + " is missing");
}
const port = Number(e.SMTP_PORT || 587);
const secure = e.SMTP_SECURE ? e.SMTP_SECURE === "true" : port === 465;
n.createTransport({
  host: e.SMTP_HOST, port, secure, requireTLS: !secure,
  auth: { user: e.SMTP_USER, pass: e.SMTP_PASSWORD },
  connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 15000
}).sendMail({
  from: e.SMTP_FROM, to: e.SMTP_TEST_TO, subject: "Mario Mikke: SMTP test",
  text: "Проверка подключения SMTP; это не заказ покупателя."
}).then(info => console.log("SMTP accepted:", info.accepted.length),
        err => { console.error(err.code || err.message); process.exitCode = 1; });'
```

Это проверяет только SMTP-соединение и приём письма, не оплату или доставку
письма сайтом. Не копируйте эти временные реквизиты в `.env.production`:
покупателям нужен постоянный, разрешённый магазином отправитель.

### Постоянная почта магазина

1. Для рабочей отправки используйте отдельный ящик магазина/пароль приложения.
   Не передавайте пароль в чат, коммит или командную строку. Поместите
   `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`,
   `SMTP_FROM` в защищённый `.env.production` на сервере
   (`chmod 600 .env.production`). Отправитель должен быть разрешён провайдером
   для учётной записи SMTP. Порт 465: `SMTP_SECURE=true`; порт 587:
   `SMTP_SECURE=false` (STARTTLS обязателен).
2. После доставки кода почтового провайдера на сервер пересоздайте Medusa,
   чтобы контейнер получил переменные. **Не запускайте `deploy.sh` только ради
   изменения почты:** он выполняет миграции. Запланируйте короткое окно
   обслуживания для пересоздания процесса:

   ```bash
   docker compose --env-file .env.production -f compose.production.yml up -d --no-deps medusa
   ```

3. Проверьте только наличие переменных внутри контейнера, не печатая значения:

   ```bash
   docker compose --env-file .env.production -f compose.production.yml exec -T medusa \
     node -e 'for (const k of ["SMTP_HOST","SMTP_USER","SMTP_PASSWORD","SMTP_FROM"]) { if (!process.env[k]) { console.error(k + ": missing"); process.exitCode=1; } }'
   ```

4. Перед проверкой заказом отправьте **одно** техническое письмо на свой
   тестовый адрес (подставьте получателя вместо `me@example.org`; команда не
   печатает пароль и не передаёт его аргументом):

   ```bash
   docker compose --env-file .env.production -f compose.production.yml \
     exec -T -e SMTP_TEST_TO=me@example.org medusa node -e '
   const n = require("nodemailer"), e = process.env, port = Number(e.SMTP_PORT || 587);
   const secure = e.SMTP_SECURE ? e.SMTP_SECURE === "true" : port === 465;
   n.createTransport({
     host: e.SMTP_HOST, port, secure, requireTLS: !secure,
     auth: { user: e.SMTP_USER, pass: e.SMTP_PASSWORD },
     connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 15000
   }).sendMail({
     from: e.SMTP_FROM, to: e.SMTP_TEST_TO, subject: "Mario Mikke: SMTP test",
     text: "Проверка подключения SMTP; это не заказ покупателя."
   }).then(info => console.log("SMTP accepted:", info.accepted.length),
           err => { console.error(err.code || err.message); process.exitCode = 1; });'
   ```

   `SMTP accepted: 1` означает приём relay, **не** появление во «Входящих».
   Проверьте входящие и спам, адрес отправителя и SPF/DKIM/DMARC домена.
   Только затем контролируемым оплаченным заказом проверьте цепочку
   `tbank.order.paid → email-smtp → ящик покупателя`; без оплаты событие
   `order.placed` не отправляет клиентское письмо.

## Reproducible local checks

Use the workspace-declared `npm@11.19.1` with the pinned Node 24.22.2.
The repository root and `medusa-prototype` have independent lockfiles.
Install each tree with `npm ci --ignore-scripts --no-audit --no-fund`;
run the explicit audit separately. Do not regenerate a standalone server
lock or bypass peer constraints with `--force` / `--legacy-peer-deps`.

Security overrides are scoped to investigated consumers, not applied as
blanket major replacements. The Rushstack consumer receives patched AJV 8;
legacy AJV 6 consumers retain their own compatible branch.
`@medusajs/eslint-plugin@2.22.4` now matches the Medusa release. The observed
backend build lint reported zero errors and 127 warnings; warnings remain
visible and are not a clean-security claim.

The Playwright fixture resolves the public `tsx` entry from the backend
package scope, rather than relying on a particular `node_modules` hoisting
layout. Install the matching browser with `npx playwright install chromium`
before running the browser suite.
The fixture readiness probe requests `/checkout`, not the unrelated home
page. Cart/payment-return seeding runs once per tab/cart, so reload cannot
overwrite server-confirmed payment authority. The final complete browser
suite passed all 37 scenarios, including confirmed-payment reload with a
404 status response and preservation of a different active shopping cart.

## Dependency security policy and residual advisories

Production dependencies are installed in the original workspace layout with
`npm ci --ignore-scripts --omit=dev`, using the repository's root `package-lock.json` and
security `overrides`. Do not generate a second standalone server lock during
the image build: npm produced a `picomatch` tree that its own `ci` rejected.
The final image retains both the root dependency tree and any backend-local
dependencies, alongside the compiled server and Admin assets.

`scripts/deploy.sh` uses `db:migrate --execute-safe-links --execute-safe-search`
so Medusa 2.22 does not hang on interactive link/search prompts. The same
safe flags passed on the isolated database copy. Unsafe link/search changes
still require explicit review; do not replace these with automatic
`--execute-all-*` flags. Keep the pre-migration dump for schema rollback.

The 12 October isolated check passed backend/admin compilation, storefront
and backend typechecks, five PostgreSQL checkout/access/upload regressions
and three delivery-quote/payment-session policy tests. The browser exercised
checkout with an offline bank `Init`, rejected an unsigned success claim,
then displayed the paid order and cleared the cart after a signed webhook.
No real payment or shipment was made. At that 12 October check, the complete
Docker image was not built because the local daemon was unavailable.
The full-image verification on 19 October supersedes that packaging limitation.

The 19 October Dockerfile pinned Node `22.23.2` and explicitly set `NODE_ENV=production`
for `medusa build`: this CLI otherwise defaults the build environment to
development. Setting it only in the runner does not fix already-built Admin
assets. The final Admin login was checked in Chromium; the previous React
development/i18next debug console output was absent.

The runtime working directory is `/app/apps/backend`. The matching production
Compose mounts the existing host `./static` at `/app/apps/backend/static`;
the host media directory and its UID 1000 ownership policy are unchanged.
Release or roll back the Dockerfile/image and Compose volume mapping together.

That 19 October local image `mm-backend-smoke:796c1c8-dockerfix`
(`sha256:d691a9e9989daf94b18930ac5ff3ccaccd8b35bf89d09c2e945d4ce8225c9a0d`)
passed compiled migrations and a repeat migration, HTTP checkout with an
offline bank, access/upload/refund guards, container recreation with persisted
order/media, and the actual Caddy ingress checks. Production Compose also
passed `config --quiet` using synthetic environment values.
See the [full Docker verification report](../docs/DEPLOYMENT_2026-09-05.md#полный-docker-image--19-октября-2026)
for evidence and limits; this was not a production deployment or a live charge.

The dependency audit was refreshed on **7 November 2026**:

| Tree | Full audit result |
| --- | --- |
| Storefront | 0 findings, including development, optional and peer dependencies |
| Medusa workspace | 12 Low package-level findings, all from the same `deepmerge` advisory; no Moderate, High or Critical |

The remaining registry entry is
[GHSA-gcqx-w48m-w2h4](https://github.com/advisories/GHSA-gcqx-w48m-w2h4),
reported for `deepmerge@4.3.1`. Its
[official CVE record](https://cveawg.mitre.org/api/cve/CVE-2026-93753)
is **REJECTED**, dated 2 November 2026, because it does not describe a
security vulnerability. GitHub/npm had not yet reflected that rejection.
The production path is Medusa → notification-sendgrid → Sendgrid helpers →
deepmerge; the development path is Jest → jest-config → deepmerge.
Sendgrid is not a configured notification provider. No fake package version,
vendor patch or audit-output suppression was added for this rejected CVE.

The former `braces` entry
[GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)
was also withdrawn upstream. It is not a current unpatched High finding.

| Consumer | Security override | Compatibility basis |
| --- | --- | --- |
| `@rushstack/node-core-library` | AJV `^8.20.0` | Same major; fixes the older pinned AJV 8 branch |
| `bullmq` | UUID `11.1.1` | Actual callers use preserved CommonJS `v4()` without arguments |
| ESLint/config-array, typescript-estree, test-exclude | minimatch `11.0.5` | Used matching APIs and options are retained; no global override |
| Jest config/runtime/reporters, test-exclude | glob `14.0.2` | CommonJS `glob.sync`, async `glob` and used path/ignore options are retained |

Backend schemas now import `@medusajs/framework/zod`, the same runtime and
types used by Medusa middleware; the redundant direct Zod dependency was
removed. Mixing direct Zod 4.6.7 with Medusa's 4.6.6 caused structural type
comparison to exhaust even a 3 GiB heap. With one schema runtime, the native
Node 24 backend/Admin build passes with a 1536 MiB heap and full type checking.
That alone does not prove Linux image packaging; its result is reported below.
The backend type library includes ES2022 for the existing `Array.at` call
while retaining the ES2021 emission target.

The storefront uses Next.js 16.4.5 / React 19.3.1. Medusa 2.22.4 keeps its
supported React 18 admin tree, exact dashboard query/i18n context versions
and Vite 7.3.7; its plugin does not support Vite 8. TypeScript 6.0.3 remains
within the supported typescript-eslint peer range, unlike TypeScript 7.
Frontend ESLint 9.39.5 is constrained by the stable React/import/a11y plugin
peers; its deprecation warning remains a maintenance risk, not an audit fix.

CI audits both complete trees. Storefront findings fail from Low upward.
The backend prints its full report and fails from Moderate upward while the
rejected Low CVE remains in the registry. Review any new Low entry explicitly;
do not assume it is this rejected CVE. No production deployment or live
financial/logistics operation is implied by these dependency checks.

## Node 24 runtime alignment — 6 November 2026

The root `.node-version` pins `24.22.2`. All repository GitHub Actions Node
setup steps consume that file; the backend Dockerfile defaults to the same
version. No production deployment or hosted-runtime setting was changed.

The Windows Node 24.22.2 backend ran against an isolated copy of the local
demo database (PostgreSQL 15 on loopback port 55434) and Redis 7 on loopback
port 56380. Native Medusa migrations and temporary-admin creation succeeded.
The HTTP smoke on port 9002 verified health, unauthenticated Admin rejection,
admin login and product access, Store catalog, RUB cart creation, guest-cart
access-token enforcement (`404` without the token, `200` with it), and adding
a variant with server-calculated pricing.

Bank, carrier, SMTP and Telegram integrations were disabled in that profile.
No order, payment, refund or shipment was created. API authentication does
not establish browser Admin acceptance: Windows Vite development startup
reported `EPERM` renaming its generated dependency cache.

The complete image `mario-node24-runtime:20261106`
(`sha256:b7eb16af6748ff167e8199452583366b9acda89de82a4f110f551dc2718303f5`)
built successfully, including backend and production Admin compilation.
The build reported 155 lint warnings and no lint errors; these warnings
were not suppressed or treated as a clean security audit.
The final image reported Node `v24.22.2`, UID `1000` and working directory
`/app/apps/backend`.

The final isolated container connected the Redis Event Bus, Cache, Locking,
Workflow Engine and PubSub, and Docker reported `healthy`. Compiled
`db:migrate` completed with `DB_MIGRATION_CONCURRENCY=1`, including link
sync and migration scripts. All 12 HTTP smoke requests passed: health,
unauthenticated Admin rejection, admin login, Admin/Store catalog, RUB cart
creation, access-token enforcement, and adding a server-priced variant.

The initial Knex pool timeouts were traced with an independent pool probe:
the production defaults requested TLS from the local non-TLS PostgreSQL
server. Only the isolated test connection string was changed to include
`?sslmode=disable`; the compiled migrations and API smoke then succeeded.
Do not copy this local-only setting to a remote database that requires TLS.
The earlier low-memory condition was observed separately and was not a
sufficient diagnosis of the connection failure.

Browser acceptance used a temporary Caddy HTTPS ingress on localhost:9443
with a local self-signed certificate trusted only by the managed browser.
Login and the actual Products table, including published statuses and
variants, were observed. The session cookie remained `Secure`, `HttpOnly`
and `SameSite=Lax`; production cookie security was not disabled to make
plain-HTTP login work. The isolated fixture media were not mounted, so this
check does not accept product thumbnails or the real launch catalog.
The Windows Vite development-cache issue above is distinct from this
successful compiled Admin verification.

No real payment, refund, order or shipment was created. No production
deployment or remote CI run was performed.

After verification, the isolated containers, databases, network, temporary
credentials and API smoke helper were removed. The original local demo
database on port 55433 was preserved. The native Node 24 backend and local
storefront were restored on `http://127.0.0.1:9000` and
`http://127.0.0.1:3001`. Both `/health` and `/catalog` returned HTTP 200;
the browser displayed the demo clothing catalog with images and RUB prices.
The storefront uses the ignored root `.env.node24-stand.local` profile
without replacing the existing `.env.local`.

At completion of the Node-only check on 6 November, the storefront still
used Next.js 16.4.0. Its first development start stopped with the security
reminder; a normal retry started the local-only server without changing
security policy flags. That was not vulnerability remediation. The
7 November dependency refresh upgraded it to Next.js 16.4.5 and supersedes
the previously open patch requirement; production remains a separate release.

## Dependency refresh verification — 7 November 2026

Both npm trees were upgraded to their latest mutually supported versions,
without `--force` or `--legacy-peer-deps`. Framework-managed Admin context
packages remain on Medusa's supported versions rather than incompatible majors.
The audit result and rejected CVE are documented above; they are not hidden
by this verification report.

| Surface | Observed verification |
| --- | --- |
| Storefront | Lint, Next type generation, TypeScript, all 16 catalog/delivery regressions, server build and Pages export passed |
| Storefront browser | All 37 Chromium checkout, payment-return, replay and delivery scenarios passed without test retries |
| Backend and Admin | Full `medusa build` passed on Node 24.22.2; backend lint: 0 errors, 127 visible warnings |
| Admin types | Separate `tsc --noEmit -p src/admin/tsconfig.json` passed |
| Backend unit behavior | All 52 suites / 793 tests passed with one worker and memory-based worker recycling on the 8 GiB Windows workstation |
| PostgreSQL HTTP/bootstrap | 3 tests passed against a separate temporary database |
| PostgreSQL payment persistence | 2 suites / 20 tests passed for notification inbox and payment reconciliation |
| Offline bank checkout | 5 HTTP tests passed, including cart access, address/upload guards and signed payment processing; bank fetches were mocked by the existing offline fixture |
| Compiled production runtime | Started the real `.medusa/server` artifact with isolated PostgreSQL/Redis; all 13 HTTP probes passed, including Admin 401, invalid content payload 400, projected inventory/prices, anonymous cart 404 and server-priced line-item creation |
| Production Admin browser | HTTPS login, Products, home-content editor and custom catalog editor loaded; no browser exceptions; session cookie remained Secure, HttpOnly, SameSite=Lax |
| Security override APIs | Actual minimatch consumers passed six matching cases; four glob consumers passed sync/async, ignore, dotfile and Windows absolute-path cases |
| Release configuration | CI YAML parsed; `bash -n scripts/deploy.sh` passed; safe noninteractive migration flags passed on the database copy |
| Original local database | Backed up before upgrading; safe schema/link/search migration and refund-status backfill passed after the database-copy checks |
| Restored local stand | Compiled backend on 9000: health 200, anonymous Admin 401, Store product read 200; Next on 3001 loaded 12 catalog cards and served a canonical product JPEG with HTTP 200 |
| Linux image packaging | Not confirmed: online `npm ci` failed with network `ETIMEDOUT`; the subsequent offline cache check exceeded 600 seconds |

The isolated Admin copy retained original media URLs at port 9000 while that
server was stopped, so its thumbnail availability was not validated by the
HTTPS browser check. It did not migrate or replace the original media.
Jest emitted its existing forced-exit advice and the resource-limited unit
runner also reported an ungraceful worker exit. Assertions passed; this is not
a clean-teardown claim. The PostgreSQL fixture also emitted the pg warning
about concurrent `client.query` calls being deprecated before pg 9.

The browser fixture's control responses now close their connections: the
previous failure was a stale API socket reused at Node 24's six-second idle
close boundary. Payment replay checks wait for the cross-origin navigation
commit instead of polling the outgoing DOM during document replacement.
No production timeout, payment allowlist or retry policy was relaxed.

The restored backend uses the compiled artifact with the original development
environment files, not the dev watcher. Its generated `static` junction points
to the original backend media directory without copying or replacing data.
Backend source edits require a rebuild before they appear in that runtime.
The storefront catalog DOM loaded, but its final screenshot could not complete;
this is not a full storefront visual-verification claim.

During the unfinished Linux packaging check, the 7.7 GiB Windows host had only
about 50–70 MiB free. The heavier dev-watcher startup also failed to acquire
database connections in time; the lower-overhead compiled runtime started
successfully without changing database pool timeouts. A full image build and
container HTTP smoke remain required before releasing these backend updates.
No new Linux image or remote CI run is claimed.

Temporary database/Redis containers, their network, synthetic environment
profiles, diagnostic scripts and experimental TypeScript installations were
removed. The pre-upgrade local database dump remains at
`%TEMP%\omp-dependency-check.dump` for rollback; it contains database data and
must not be committed or published.

No live payment, refund, shipment or production deployment was performed.

## Isolated Linux candidate verification — 7 November 2026

This server-side run supersedes the outstanding Linux packaging gate above.
It is not a production deployment or approval to enable checkout.

- Server access verified at `129.101.103.52`.
- Built and loaded image: `mm-backend-payments:20261107-node24`.
- Image ID:
  `sha256:d4ee175aa4d06b568241ae079119414a3b4a916e93cd3677e1bda2fb5e6445a0`.
- Runtime probe: Node 24.22.2, Medusa 2.22.4, non-root UID 1000.
- Linux build completed, including the backend and Admin bundle. Existing lint
  output reported zero errors and 127 warnings; this was not a warning-free run.

Before testing, a PostgreSQL custom-format dump, media archive and copies of
the live deployment configuration were saved under
`/opt/mario-candidates/payments-20261107/`. The directory is root-only; dumps,
archives and configuration copies containing credentials are private artifacts,
not repository files. These backups remain on the same server and do not
replace an off-server backup.

The database dump was restored into a separate PostgreSQL 15 container with
`pg_restore --single-transaction --exit-on-error --no-owner --no-acl`.
Candidate PostgreSQL, Redis, backend and temporary HTTPS proxy used an internal
Docker network without outbound access. Carrier and TBank providers were
disabled, SMTP/Telegram credentials absent, and worker mode set to `server`.
No production database migration or service restart was performed.

The first migration attempt exposed Medusa's non-localhost PostgreSQL TLS
default. Appending `?sslmode=disable` to the generated candidate database URI
fixed that private Docker-network connection; migrations then completed.
This is not a recommendation to disable TLS for external database connections.

Observed candidate checks:

- `/health` 200; anonymous Admin request 401; existing administrator login 200.
- 33 undeleted products, including 21 published; Store API returned 21 products.
- Cart read without its capability token 404, with the token 200.
- Adding one available variant succeeded at its calculated server price
  of 3,990 RUB, not a browser-supplied price.
- Existing media returned 200 as `image/webp`.
- Real Chromium over private HTTPS loaded Products, the homepage content
  editor and catalog editor. No catalog/content changes were saved.
- Session cookie was Secure / HttpOnly / SameSite=Lax.
  Logout returned 200; a subsequent protected request returned 401.
- Automatic TBank refund failed with `not_allowed` before a bank call,
  exercised separately with networking disabled.

The private HTTPS proxy was reached over SSH to its internal bridge address.
No candidate HTTP or HTTPS listener was publicly exposed. The self-signed
test certificate exception was restricted to `https://localhost:19443`;
certificate verification for public sites was not disabled.

The new image serves local files from `/app/apps/backend/static`.
The live old image uses `/app/static`. The smoke run mounted the existing
media directory read-only at the new path. A real upgrade must update the mount
and verify write permissions for UID 1000 without deleting or replacing media.
Rollback must restore the old image, compatible mount, configuration and
pre-migration database together. Do not point the old backend at a migrated
database and assume compatibility.

`compose.candidate.yml` is now a standalone private rehearsal stack, not a
production override. Never merge it with `compose.production.yml`. Use a
candidate-only env file and an explicit unique project name:
`docker compose --env-file /PRIVATE/candidate.env -f compose.candidate.yml -p RELEASE_NAME …`.
It fixes external providers off, exposes no ports, uses an internal network,
separate data/media volumes and resource limits. `CANDIDATE_BACKEND_IMAGE`
must reference an already built reviewed image; this stack cannot build/pull it.
Do not run `deploy.sh` as a preflight check: it changes live deployment state.
Before cutover, take a fresh backup and copy it off-server, preserve the
verified source/image, prepare matching frontend and backend releases for the
cart capability contract, and schedule a rollback-capable maintenance window.
Keep public checkout closed until payment and fiscal acceptance is complete.

The frontend payment redirect policy now accepts the exact existing
backend-approved hostname `pay.tbank-online.com`. HTTPS, exact-host,
credential and port restrictions remain intact. All 17 existing profile tests,
including the added payment-session regression, passed. This frontend change
was not deployed.

Release blockers: the available TBank terminal has demo/test indicators and
has not been confirmed as live; production SMTP settings are absent. Obtain
confirmed live `TBANK_TERMINAL_KEY` / `TBANK_PASSWORD` and actual
`SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`,
`SMTP_FROM` through a private channel, not a public issue or commit.
The cashbox provider must approve taxation/marking and the complete prepayment,
handover and refund receipt lifecycle; the existing prepayment receipt alone
does not prove compliance. Automatic refunds remain blocked.

Production remains on `mm-backend-catalog:20261107-sales` with Medusa 2.17.2 /
Node 22.14.0. Public checkout was rechecked in Chromium and remains unavailable.
No real payment, refund, order, email or carrier operation was performed.

After verification, the candidate containers, copied database volume, isolated
network, generated runtime profiles, temporary proxy, SSH tunnel, browser profile
and dedicated BuildKit builder/cache were removed. The built image, source
archive and protected backups remain available on the server. The live API
returned `OK` over verified HTTPS after cleanup; its original backend,
PostgreSQL, Redis, Caddy and backup containers remained running.

## Payment/shipping closeout source verification — 7 November 2026

New source was checked separately under
`/opt/mario-candidates/closeout-20261107/{backend,frontend}`. The image
`mm-backend-payments:20261107-node24` supplied Node/npm for these checks;
**it does not contain these newer source changes and is not the new release**.
The live image, production database and public checkout state were not changed.

The source now requires coordinated frontend/backend deployment:

- Payment initialization requires buyer-approved `data.expected_total`.
  The backend recalculates delivery and cart totals before contacting the bank.
  The frontend requests renewed approval when that total changes.
- Cart mutation routes reject changes after payment initialization.
  Unchanged recipient/address/metadata/shipping replay remains valid.
- Complete-cart and Admin fulfillment routes require full net captured payment.
  Native generic provider webhooks are not a second authoritative TBank path;
  `/hooks/payment/tbank` owns signed notification processing.
- `checkout-holds` is a registered module. Payment initialization, reconciliation
  and expiry processing must be deployed together. Do not drop its ledger or
  release uncertain expired holds as an operational shortcut.
- Russian Post is no longer a selectable provider. Re-run the existing import
  only under the normal reviewed data-import procedure: it also disables
  historical Postal shipping options. Do not run it against production merely
  as a test.

New migrations include:

- `tbank-notifications/Migration20261107120000`: preserve whether a notification
  supplied `Amount`; historical records default to “provided”.
- `checkout-holds/Migration20261107130000`: persistent online stock holds and
  their payment/order lifecycle.

Before applying migrations, take a fresh protected database/media/configuration
backup and copy it off-server. Prepare a newly built, uniquely identified image
from the verified source, the matching frontend, the correct static-media mount
and UID 1000 write permissions. Keep checkout closed through acceptance.
Rollback includes compatible image, configuration, media mount and database;
never silently restore a pre-payment dump after accepting new payments.
Pause sales and reconcile all post-backup bank/order activity before approving
such a rollback.

Observed source checks: 39 browser scenarios against a synthetic Store API,
5 native Medusa/PostgreSQL HTTP scenarios with a mocked bank and manual
fulfillment transport, 817 backend unit tests and 18 frontend contract checks.
The native HTTP run verified unpaid completion/fulfillment rejection,
last-unit competition, expired-hold retention, late signed capture, webhook
deduplication and frozen paid-checkout recipient/delivery data.
These are not real carrier acceptance, fiscal receipt or email-delivery tests.

Final frontend TypeScript checking and the full backend/Admin build passed.
Lint reported 0 errors and 135 warnings; this was not a warning-free build.
After compilation, the compiled payment-provider script passed all 8 offline
scenarios in a container with `--network none`. The final 817-test server
unit run and build also ran with external networking disabled.
The separate Next.js 16.4.5 production build also passed, including TypeScript
and all 31 static pages. It used no production frontend environment profile:
this demonstrates buildability, not a configured storefront release.

Remaining release gates:

1. Confirmed live bank credentials/moderation and explicitly authorized,
   controlled real payment/fiscal acceptance.
2. Approved prepayment, closing and refund receipts plus marking lifecycle;
   automated money refunds remain blocked.
3. Working SMTP and confirmed notification recipients; readiness/shipping
   notifications are not automatically sent by this application.
4. Transfer the existing per-unit packed measurements to actual catalog variants
   and configure the confirmed CDEK staff-handoff point. Separately packed units
   are supported as distinct places; no combined-box measurement is required.
5. Controlled real carrier acceptance, real waybill and handoff/status checks.
   CDEK application UUID is not a waybill.
6. 1C-side reservation/exchange: the online ledger cannot prevent a physical
   store sale without the corresponding 1C process.

See `docs/PROJECT_STATUS_AND_LAUNCH_PLAN.md` and
`docs/FISCALIZATION_ATOL_STATUS.md` in the repository root for business and
fiscal boundaries. Do not treat a passing build or `CONFIRMED` as permission
to open public checkout.

## Multi-place shipping source update — 8 November 2026

Every already-packed product unit is a distinct physical place. There is no
combined-box estimate. Cart/order line IDs change during native completion;
manifests bind actual variant identity, unit price, dimensions and quantities
independently of line iteration order. Fixed customer delivery fees are charged
once per order; actual carrier costs stay separate.

Deployment contract changes:

- CDEK shipping/fulfillment data uses `validated_packages`, not the old singular
  field. Yandex uses `package_manifest`, not flat single-parcel dimensions.
  All source callers were migrated; there are no compatibility aliases.
  Revalidate shipping on unpaid carts through the normal checkout workflow.
- Public `POST /store/cdek/calculate` now accepts
  `{to_city_code, tariff_code?, packages:[{weight,length,width,height}]}`.
  Client-supplied measurements in that diagnostic endpoint do not authorize
  payment or fulfillment; checkout derives its manifest from real variants.
- The initial singular CDEK sender-point env setting was replaced on 9 November
  by the native warehouse-address handoff registry described below.
  Missing/disabled allowed source blocks paid preparation and booking.
  `CDEK_FROM_CITY_CODE` remains a diagnostic default, not a handoff selection.
- CDEK bookings contain required real item identity/title/RUB prices, one unit
  per package and zero COD, without invented VAT data. Yandex sends multiple
  places and one linked `count:1` item per place through `place_barcode`.
- Payment-cart replay must not invoke native inline-address replacement with
  an unchanged partial address: it clears omitted names/phone. The guard turns
  an unchanged cart replay into an empty update and preserves full saved
  shipping data for unchanged method replay. Changed values still return 409.

Source verification: 901 unit tests in 55 suites; 5 native HTTP scenarios with
PostgreSQL; separate real-provider/HTTP-client smoke for 2+1 units proving
three correctly measured places, fee once, separate costs, changed native
line IDs, reordered inputs and rejection of partial/replaced/tampered goods.
Carrier transport was synthetic; the provider smoke had networking disabled.

Final backend/Admin build passed. The same provider/client smoke passed against
emitted JavaScript in `.medusa/server`, not just TypeScript source. Build lint
reported 0 errors and 135 warnings; these warnings were not suppressed or fixed
as part of this shipping change. No storefront source changed in this update.

The application's 100-place cap is not an account/carrier acceptance guarantee.
Yandex standard Market PVZ limits are 30 kg per place, 150 cm per side, 300 cm sum
of sides and 200 kg per order. Restricted lanes/smaller PVZ can be stricter; require
carrier acceptance and a controlled real handoff. Yandex may replace submitted
place barcodes: do not print assumed operational labels from those IDs.

Primary API contracts:

- [CDEK order registration](https://apidoc.cdek.ru/#tag/order/operation/register_1)
  and its [official OpenAPI](https://gateway.cdek.ru/api-cdek-docs/web/docs/merged?sectionId=api_v2_integration).
- [Yandex pricing](https://yandex.ru/support/delivery-profile/ru/api/other-day/ref/1.-Podgotovka-zayavki/apib2bplatformpricing-calculator-post.md),
  [offers](https://yandex.ru/support/delivery-profile/ru/api/other-day/ref/3.-Osnovnye-zaprosy/apib2bplatformofferscreate-post.md)
  and [weight limits](https://yandex.ru/support/delivery-profile/ru/other-day/weight-limits.md).

No new shipping migration or production deployment was performed for this
update. Real booking, bank/cashbox acceptance, actual catalog measurements,
SMTP and 1C remain release gates. DNS/Vercel were not changed.

## Multiple staff-dropoff origins — 9 November 2026

Use Admin → «Пункты сдачи» (`/app/dispatch-points`) to configure origins for the
native stock location used by each shipping option. Do not create inventory
warehouses for carrier PVZ. Data is stored at
`stock_location.address.metadata.carrier_handoff`, preserving the warehouse's
other address fields and metadata. Medusa 2.22.4 projects `address.*` during
native pricing/validation; root location metadata is not projected on every
price path. At fulfillment time its ORM DTO drops the transient `location`.

The registry has independent optional `cdek` and `yandex` groups, each
`{default_id, points:[{id,name,address,active,city_code?}]}`. CDEK requires its
real positive city code per point; Yandex IDs identify confirmed dispatch
stations. IDs must be unique within a carrier, and any non-empty active list
requires an active default. Disabling all requires `default_id:null`.
Registry routes require admin authentication and the native `stock_location`
read/update permissions. Store-supplied source fields cannot override the
server-selected checkout default.

In the native order screen, the «Пункт сдачи перевозчику» widget selects an
allowed point and creates a native fulfillment, forwarding
`additional_data.dispatch_point_id` via Medusa's fifth provider argument.
The native Admin fulfillment middleware reloads the authoritative warehouse
registry and overwrites `additional_data.handoff_location`, including any
client-supplied value. Providers require its ID to match native `location_id`.
Internal workflow callers must likewise obtain this context from the stock
location service; missing/mismatched context fails closed. Never copy it from
an untrusted request or a checkout snapshot.
Native payment, order, item and inventory validation remain authoritative.
The ordinary native fulfillment action also works with the saved checkout
origin. If that origin is disabled/deleted, it fails rather than silently
using a different default. An admin may explicitly select an allowed alternate.

Both providers requote from the selected source before booking, charge the
same configured fixed buyer fee, and persist `data.handoff_origin` plus actual
carrier expense. CDEK checks reception capability, PVZ type and city before a
quote/booking. Yandex passes the same explicit source to pricing and offers;
a receiving-only PVZ is not assumed to support dispatch. Carrier rejection
blocks the operation. Existing fulfillment snapshots do not change when the
registry/default/name/address changes.

Clean cutover: remove `CDEK_SHIPMENT_POINT_CODE` and
`YANDEX_DELIVERY_SOURCE_STATION_ID` from runtime env. Before opening checkout,
transfer their previously confirmed values into the appropriate native
warehouse address registry using the Admin screen, with actual names/addresses.
There is no runtime env fallback or automatic guessed origin. This source
update did not migrate production data or deploy a new image. No schema
migration is needed: the existing native address metadata stores the registry.
An old paid order without a source snapshot needs an explicit allowed selection
by staff when booking, never a silent fallback.

The read-only Yandex diagnostic script uses `YANDEX_CHECK_SOURCE_STATION_ID`.
It does not configure checkout. Public Yandex calculation resolves a native
sales-channel/shipping-option source; with several eligible source options and
no saved native selection it rejects ambiguity rather than choosing arbitrarily.

Primary contracts: [Medusa fulfillment provider](https://docs.medusajs.com/resources/references/fulfillment/provider),
[native order fulfillment](https://docs.medusajs.com/api/admin/orders/create-fulfillment),
[CDEK reception points](https://apidoc.cdek.ru/#tag/delivery_point/operation/search),
[CDEK shipment_point](https://apidoc.cdek.ru/#tag/order/operation/register_1),
[Yandex source in pricing](https://yandex.ru/support/delivery-profile/ru/api/other-day/ref/1.-Podgotovka-zayavki/apib2bplatformpricing-calculator-post.md)
and [offers](https://yandex.ru/support/delivery-profile/ru/api/other-day/ref/3.-Osnovnye-zaprosy/apib2bplatformofferscreate-post.md).

## Closed release artifacts and restore rehearsal — 9 November 2026

Production was not switched. The prepared release lives in the private directory
`/opt/mario-releases/20261109-prelaunch`; `release-manifest.json` records source
and artifact SHA-256 values, the exact Docker IDs, runtime profile, observed
checks and outstanding gates. `SHA256SUMS` covers the retained archives.

- Backend: `mm-backend-closeout:20261109-node24`, Node 24.22.2 /
  Medusa 2.22.4, non-root UID 1000. `backend-image.tar.gz` contains this image.
- Frontend: `storefront-closed-linux-node24.tar.gz`, Next 16.4.5, 31 built
  routes. It contains the normal Next server build, public assets, Linux
  dependencies and configuration, excluding build caches. It is neither
  standalone output nor a Vercel prebuilt deployment.
- Frontend build profile: `BUILD_TARGET=`; both data modes `medusa`;
  `NEXT_PUBLIC_MEDUSA_PAYMENT_PROVIDER_ID=`;
  `NEXT_PUBLIC_ALLOW_TEST_CHECKOUT=false`. Public API/canonical origins are
  `https://api.mariomikke.shop` and `https://www.mariomikke.shop`.
  Publishable key and RUB region match the restored production snapshot.
  Set `MEDUSA_BACKEND_URL` explicitly for the intended runtime backend.
  Do not publish a different frontend against the old cart-capability contract.

### Backup and isolated restoration

`scripts/backup-release.sh` requires explicitly verified container identities,
the real live compose directory, an encryption recipient certificate and a
private output directory. The verified live identities for this rehearsal were:

```bash
POSTGRES_CONTAINER=mario-mikke-postgres-1 \
BACKEND_CONTAINER=mario-mikke-medusa-1 \
REDIS_CONTAINER=mario-mikke-redis-1 \
bash scripts/backup-release.sh \
  /opt/clothing-store/medusa-prototype \
  /private/recipient.pem /private/backups
```

The script verifies compose ownership and the backend/Redis working directories
before dumping. A wrong-project PostgreSQL container was rejected in the
rehearsal. It captures a custom-format PostgreSQL dump, the exact running backend
image and protected Docker runtime metadata, authenticated whole-instance Redis
RDB with `redis-check-rdb` proof, deployment env/configuration and static media
with component checksums. OpenSSL CMS AES-256-GCM encryption uses only the public
recipient certificate on the server; plaintext temporary files are removed on
exit. Redis replication-snapshot bookkeeping is not an application-data write.
For a coordinated recovery point, stop all backend/queue writers under
maintenance before the final PostgreSQL and Redis snapshots; sequential snapshots
of an active system are not a common cutover point.

`release-20261108T203016Z.tar.gz.cms` was copied off-server, authenticated and
decrypted using the private key retained on the workstation. The plaintext
archive hash and all component hashes matched. Preserve that offsite ciphertext
and its private key separately; neither belongs in the repository.

After trusted decryption, checksum verification and private extraction, restore
only into a fresh, explicitly named rehearsal project:

```bash
bash scripts/restore-candidate.sh \
  /private/candidate.env /private/snapshot mm-rollback-20261109
```

This script uses only the standalone `compose.candidate.yml`; it does not merge
the production compose file. It accepts only `mm-closeout-*` / `mm-rollback-*`
project names, verifies the candidate database/role, refuses a nonempty public
schema or media directory, restores owned private volumes, and does not start
the backend or run migrations. Refusal to overwrite an already restored DB was
exercised. A fresh candidate needs new rehearsal-only secrets, not production
provider, SMTP or staff MFA credentials.

Two independent restorations were exercised:

1. The new image migrated the cloned database and started successfully:
   38 products, 1 order; native Admin and Store API smoke checks passed.
2. The exact old image started against a separately restored pre-migration DB
   and media with its old `/app/static` mount and without migrations:
   health 200, 38 products, 1 order. The new image's media path is
   `/app/apps/backend/static`; never reuse the wrong mount or run the old
   binary against a migrated database as an assumed rollback.

### Observed release checks and limits

Backend checks: health 200; anonymous Admin 401; fixture login and dispatch-point
screen 200; HTTPS session cookie `Secure`, `HttpOnly`, `SameSite=Lax`; cart
without capability 404 and owner access 200; native payment collection 200 and
system payment session rejected with 400.

Real Chromium checks used the built frontend and native isolated Medusa, not
synthetic Store API responses: catalog photographs, product page, cart creation
and line-item addition 200, persisted cart with payment disabled, and direct
checkout unavailable without a payment form. SSR used the private backend;
browser fetch/XHR origins were rewritten to it with production Store API blocked
by the browser allowlist. Public images were fetched read-only by Next image.
An internal-only network initially blocked those image requests; a separate
frontend-only egress network enabled public media reads. Private-IP image
blocking and TLS validation were not disabled.

The native dispatch-point screen is present but the restored warehouse registry
is empty: transfer previously confirmed carrier points into the native warehouse
address metadata before opening shipping. No guessed point was written.
The live backend stayed on `mm-backend-catalog:20261107-sales`, public health
remained OK, and read-only live counts remained 38 products / 1 order.
No real payment, refund, email or carrier booking was performed.

This proves backend/database/media restoration, not complete production
rollback. The Vercel artifact/export and frontend rollback still require the
owner's access. Before any approved cutover, take a fresh offsite backup, retain
the currently published frontend artifact and runtime secrets, coordinate both
releases under maintenance, and verify rollback of both surfaces. After taking
real payments, never restore an old database blindly: reconcile bank, fiscal,
carrier and 1C events first.

Keep checkout closed until the confirmed live bank, fiscal/marking lifecycle,
actual catalog packaging, SMTP and 1C acceptance gates are met. Rehearsal
containers, volumes, tunnels, decrypted snapshot and dedicated build cache were
removed after proof. Release archives, rollback configuration and the encrypted
offsite backup were retained; the existing local development services were not stopped.

## Release publication gate and main integration — 9 November 2026

GitHub access permits branch publication, but direct Vercel project access is
not available. The current custom domain is served by Vercel; the latest
successful GitHub Production deployment refers to main
`7062b821ab6ac76a7abb6cd867e72c22125f033a`, project `clothing-store`,
deployment `dpl_G7G2viAvqtqX6rAAHRVLZ2vbbBpB`.
The immutable deployment and preview require Vercel SSO; unauthenticated API
access returns `403 missingToken`. GitHub records alone do not authenticate the
current alias assignment, project env, preview behavior or an immediate rollback.
Pushing main can publish Vercel independently of the Pages workflow: do not use
a blind main push as a deployment test.

Fetching origin/main exposed six newer colleague commits, including customer
accounts and catalog/manual-stock changes. The retained prelaunch source/image
archives predate this integration and are historical proof, **not** deployable
artifacts for the merged release. Rebuild from the reviewed merged commit and
record new identities before any coordinated cutover. The release branch is
`release/20261109-closed`; customer DOCX documents, Office lockfiles, private
runtime profiles and backup files are excluded from publication.

A newer snapshot `release-20261109T110830Z.tar.gz.cms` includes Redis and exact
runtime metadata. Its offsite copy passed authenticated decryption and all
10 component checksums. The RDB was actually loaded into Redis 7.4.11 without
network access or production volumes: PONG, 1020 loaded keys, four naturally
expired keys discarded. Plaintext fixtures and the isolated Redis were removed.
This exercise was taken while the old application was running; take a new,
quiescent PostgreSQL/Redis snapshot at the eventual maintenance window.

The old backend currently has TBank enabled despite the storefront checkout
being closed. The new disabled-provider configuration rejects nonempty payment
settings: a closed cutover must disable all provider flags and clear the eight
TBank payment variables, retaining originals privately for rollback. Preserve
actual JWT/cookie/MFA secrets, not newly generated candidate values. The prepared
private override pins the pre-merge image and must be regenerated for a new
merged image. Server-only worker mode does not make Medusa read-only: synchronous
workflows and startup can still write Redis; do not assume queue rollback is
unnecessary. Restoring the production Redis AOF/RDB volume is a separate
controlled operation, not something `restore-candidate.sh` currently performs.

Production stays unchanged until the Vercel owner can authenticate the preview,
confirm the closed production build profile, retain/promote the previous
deployment for rollback and coordinate publication with the backend. A Git
revert/rebuild is slower, depends on current build/env settings and is not a
verified instant alias rollback. The host also reports Redis memory-overcommit
disabled; evaluate that host setting separately before relying on background
saves under memory pressure.

### Merged account/cart acceptance and Git publication block

The merged source passed 951 backend unit tests and 45 frontend regressions
(10 catalog, 10 delivery, 25 account), typecheck and lint. Linux Next server
build generated 31 routes; the separate Pages mock export generated 43.
Frontend dependency audit reported zero findings. Backend audit passed the
configured moderate threshold with the previously documented 12 low transitive
deepmerge findings; this is not a zero-finding backend audit.

Actual built Next behind private HTTPS plus isolated native Medusa 2.22.4
exposed and confirmed fixes for two account boundary errors: same-origin POSTs
behind a reverse proxy were rejected, and a selective cart query returned only
`id`, letting the previous ownership guard skip verification. The new guard
uses the native default cart response, requires explicit valid ownership data,
permits null/same owner and rejects every foreign owner without consulting the
obsolete `has_account` hint. Forged forwarded headers do not authorize an origin.

Observed native/browser results: registration/login; guest create/add and
guest-to-customer linkage; signed-in create/add with preserved capability;
missing capability 404 at Store API; foreign-customer linkage 409 with owner
unchanged; same-owner linkage 200; forged Origin 403; customer orders 200 with
zero own orders; Secure/HttpOnly/SameSite=Lax cookie; logout 200 followed by
empty session and orders 401. The cart payment button remained disabled and
direct checkout had no payment form. Test customers/carts existed only in the
disposable clone. The fixture used the prepared native 2.22.4 image for its
unchanged auth/capability contract, not a newly built merged catalog image.
The separate fresh merged-image acceptance is recorded below.

The initial publication attempt for `release/20261109-closed` was rejected
because the old GitHub OAuth authorization lacked `workflow` scope for CI.
After the account rename to `funMachie`, a fresh login granted `workflow`
alongside `gist`, `read:org` and `repo`. The prepared release branch was then
successfully published through the standard HTTPS/keyring credential helper.
This resolves Git publication authorization, not Vercel project access or
production deployment. Do not use a main push as a substitute for preview and
rollback verification.
Vercel owner participation remains separately required before merging main.

After acceptance, the private Next/Caddy/Medusa/PostgreSQL/Redis fixture,
synthetic customer data, own networks/tunnel, browser profiles and intermediate
source/profile files were removed. Production and existing local services were
not restarted or switched.

### Final rebuilt artifacts from merged source `3ec20fa`

The release is retained at `/opt/mario-releases/20261109-closed-3ec20fa`
with four archive SHA-256 entries, `release-manifest.json` and the public-only
closed storefront profile. Runtime source is committed locally; documentation
commits after `3ec20fa` do not imply that a different runtime was built.

- Backend `mm-backend-closed:20261109-3ec20fa`,
  image `sha256:877fced513ec001e0c2caa2cdd4cc3f668617dc3046c354d3bd64c7b59bd0901`,
  Node 24.22.2, Medusa 2.22.4, UID 1000. Both backend and native Admin compiled.
  The dedicated BuildKit container was bounded to 2400 MiB and one CPU.
  Docker Hub returned 429 for the Node pull; the unchanged Dockerfile used a
  named base-image context from the Docker Official Images ECR mirror, pinned
  to index `sha256:01d566e8d94d8c619591d78652babfccd3c6992a3dffa9ed5ab39e11cf6c70e9`.
  Its OCI source annotation points to `nodejs/docker-node`.
- The new image ran `db:migrate --execute-safe-links --execute-safe-search`
  only on a fresh isolated PG/media clone, then became healthy. Read-only counts
  remained 38 products and 1 order. HTTP returned health 200, anonymous Admin
  401, native Admin app 200 and Store catalog 200 with 21 visible products.
  Native cart creation/addition and capability-authorized read returned 200;
  a read without capability returned 404. The line item had a positive
  server-calculated total. Native payment-collection creation returned 200,
  but `pp_system_default` payment-session creation was rejected with 400.
  All five external payment/carrier flags were false; no real operation ran.
- The final Linux storefront used the public production API/site origins,
  empty payment provider and test checkout false. `npm ci --include=dev`
  avoids the runtime image's production default omitting build dependencies;
  the final build did not rely on Next auto-installing TypeScript. It produced
  31 server routes. Actual loopback runtime returned 200 for home, catalog,
  closed checkout without a form and empty account session; forged Origin plus
  forwarded host returned 403. This is an ordinary server bundle, not a Vercel
  prebuilt deployment or proof of Vercel's project environment.

Both compiled archives passed `gzip -t`; source and compiled archive checksums
are retained in the release ledger. The new fixture, plaintext PG/media
snapshot, candidate-only secrets, extracted build trees and dedicated BuildKit
cache were removed after proof. The final image and release archives remain.
Old private cutover profiles are still pinned to the previous rehearsal image:
regenerate them for this exact image, preserve production secrets and take a
fresh stopped-writer PG/Redis backup when the coordinated window is available.
GitHub publication authorization is restored; Vercel access still gates release.

## Backend-only private review — 10 November 2026

The owner deferred Vercel/storefront work. This is a retained private backend
review environment, not an independent production cutover:

- Root: `/opt/mario-releases/20261109-backend-only` (0700).
- Compose project: `mm-closeout-backend-only-20261109`.
- Runtime source: `cc4b339a06110a85c9aa5b320b366aeca49d8af3`.
- Image: `mm-backend-only:20261110-cc4b339`,
  `sha256:d13e83b2dbe236ff3fba6309da51f20913c745c1017c7f892d1e569d49db6af7`.
  Native backend and Admin were rebuilt; observed Node 24.22.2, Medusa 2.22.4,
  UID 1000. The pinned official ECR Node base is the same as documented above.
- PostgreSQL, Redis and media use separate candidate volumes. The backend has
  no published port and stays on an internal network without external egress.
  Only the private Caddy has an ingress network and publishes
  `127.0.0.1:19443 -> 8443`. No production mount, secret or database is shared.
- Payment/carrier flags remain false; SMTP and Telegram are absent. Production
  bank callback URLs must not be exercised from this clone. No payment,
  refund, shipment, cancellation or customer notification was created.
- Services intentionally have `restart: "no"`; no unattended restart after a
  host reboot is promised. Production containers and existing local services
  were not restarted.

Use the exact project directory so `./Caddyfile` resolves to the retained root:

```bash
docker compose \
  --project-directory /opt/mario-releases/20261109-backend-only \
  --env-file /opt/mario-releases/20261109-backend-only/candidate.env \
  -f /opt/mario-releases/20261109-backend-only/backend-source/compose.candidate.yml \
  -f /opt/mario-releases/20261109-backend-only/compose.backend-only.yml \
  -p mm-closeout-backend-only-20261109 \
  up -d --no-build --wait --wait-timeout 150
```

Access native Admin at `https://localhost:9443/app` through:

```bash
ssh -N -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 \
  -L 127.0.0.1:9443:127.0.0.1:19443 mario-mikke-demo
```

The local private directory
`C:/Users/baira/.omp/backups/mario-mikke/20261109-prelaunch/backend-only`
contains `admin-access.json`, `localhost-root-ca.pem`, `backend-only-proof.json`
and `confirmed-dispatch-candidates.json`. Do not publish these files or copy
review credentials into production. HTTPS was verified against the explicit
private CA; browser proof used an isolated Chrome profile pinned to the leaf
SPKI, not a global TLS bypass or Windows trust-store change. A normal browser
does not automatically trust this private CA.

Actual rebuilt-runtime HTTP checks: health 200; anonymous Admin 401;
authenticated dispatch registry 200; capability-authorized native cart and
shipping-option reads 200. Native shipping calculation without a capability
previously reached the handler and returned 500 for the restored flat manual
option. The fixed route returns 404 with `Cache-Control: no-store` both without
a key and with another cart's real key. The manual provider cannot calculate
a carrier tariff; successful authorized CDEK/Yandex calculation and native
paid-fulfillment transitions are covered by the separate offline HTTP suite,
not misreported as live carrier checkout on this clone.

CI [42717280737](https://github.com/dnsptr/clothing-store/actions/runs/42717280737)
at `745d696` passed 951 unit tests, five offline checkout cases, three carrier
HTTP cases and 21 PostgreSQL payment-recovery cases, plus frontend checks and
builds. The workflow now explicitly enables the checkout and carrier suites;
their prior skips in the general HTTP job were not positive coverage.
Actual browser login, product editor and dispatch-point screen also worked
on the rebuilt image with no captured browser errors.

Read-only external probes ran in separate short-lived diagnostic containers,
not by enabling integrations in the retained clone:

- T-Bank `CheckOrder`: accepted signature, expected missing-order code 335;
  production API with a DEMO terminal. No `Init` or financial operation.
- CDEK: the provided live keys authenticate against `https://api.cdek.ru/v2`;
  do not combine them with the old EDU URL/keys. An illustrative 1000 g,
  30 × 20 × 10 cm Moscow–Saint Petersburg parcel returned 285 RUB for tariff
  136 and 540 RUB for 137. These are sample quotes, not real-order prices or
  approval to change the fixed buyer fees.
- Yandex: city/PVZ lookup and illustrative price calculation succeeded.
  A separate `available_for_dropoff: true` lookup confirmed the existing
  source ID at `Москва улица Татьянин Парк 19 к2`.
- CDEK `MSK2545`, `ш. Боровское, 2к3`, city 44, was confirmed as a receiving
  `PVZ` with `is_reception=true`, Monday–Sunday 09:00–21:00.

Confirmed public point metadata is retained privately, but not assigned to
the arbitrary restored warehouse. Native data still has one «Основной склад»
and empty source registries. Map it to the confirmed Mosmart consolidation
workflow before creating native carrier options/providers and assigning origins.
Of 217 native variants, 159 lack at least one positive packaged-measurement
field. Import the measurements already supplied by the client; do not ask for
them again or synthesize dimensions. Positive fields alone do not prove that
the measurements describe real packaging.

Own courier is the only agreed free method inside MKAD. The implemented free
period ends at `2027-01-01T00:00:00+03:00`; afterwards the method is unavailable
until a positive approved price is configured. Do not describe it as perpetual.
Live terminal ownership, final/return receipts, marked-goods handling and the
cash-register process remain launch gates; a successful read-only bank probe
does not close them. See `docs/FISCALIZATION_ATOL_STATUS.md` at repository root.

After proof, the plaintext restore snapshot, temporary carrier-key profiles,
isolated browser profile and dedicated BuildKit container/cache were removed.
The review stack, its private configuration, image, source archive, CA,
credentials and SSH tunnel remain for review. Review-only carts/account exist
only in the clone. This is not a fresh stopped-writer production rollback point.
