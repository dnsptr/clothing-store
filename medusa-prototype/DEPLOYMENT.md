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

Use the workspace-declared `npm@10.9.0` for dependency installation, including
lockfile maintenance. A clean
`npx --yes npm@10.9.0 ci --ignore-scripts --no-audit --no-fund` resolved the
restored lockfile without damaged-lock warnings. Do not regenerate it with a
different resolver and assume the Medusa/MikroORM dependency layout is equivalent.

The root AJV override keeps modern consumers on AJV 8; ESLint and
`@eslint/eslintrc` explicitly retain their supported, patched AJV 6 branch.
Forcing AJV 8 into those legacy consumers prevented the lint command from
loading. `@medusajs/eslint-plugin@2.21.2` also normalizes Windows module paths;
the previous plugin incorrectly reported same-module model relationships as
cross-module references. Actual backend lint now completes with zero errors
and 155 warnings; warnings remain visible.

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

The monorepo `overrides` also apply to the generated production server:
the Docker builder copies that policy into its package, generates its own
lockfile, and the runner uses `npm ci --omit=dev`. Do not replace that step
with an unconstrained install; the generated package is a separate npm root.

The 12 October isolated check passed backend/admin compilation, storefront
and backend typechecks, five PostgreSQL checkout/access/upload regressions
and three delivery-quote/payment-session policy tests. The browser exercised
checkout with an offline bank `Init`, rejected an unsigned success claim,
then displayed the paid order and cleared the cart after a signed webhook.
No real payment or shipment was made. The complete Docker image was not
built: the local Docker daemon was unavailable; the generated-server policy
command and its independently resolved runtime lock were exercised.

Registry advisory lookup is **not clean**. These packages remain in the
resolved Medusa runtime tree; inclusion alone does not prove a reachable
exploit. Major replacements in the vendor's router/build/parser stack were
not forced without compatibility evidence.

| Package | Severity | Advisory |
| --- | --- | --- |
| `braces@3.0.3` (also storefront development dependencies) | High | [Nested-pattern DoS](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) |
| `vite@5.4.21` | High/moderate | [Windows path bypass](https://github.com/advisories/GHSA-fx2h-pf6j-xcff), [optimized-map traversal](https://github.com/advisories/GHSA-4w7w-66w2-5vf9), [Windows UNC disclosure](https://github.com/advisories/GHSA-v6wh-96g9-6wx3) |
| `esbuild@0.21.5` under Vite | Moderate | [Development-server request exposure](https://github.com/advisories/GHSA-67mh-4wv8-2f99) |
| `react-router@6.30.4` | Moderate | [Backslash redirect](https://github.com/advisories/GHSA-wrjc-x8rr-h8h6), [SSR error deserialization](https://github.com/advisories/GHSA-337j-9hxr-rhxg) |
| `react-router-dom@6.30.4` | Moderate | [Redirect/XSS](https://github.com/advisories/GHSA-jjmj-jmhj-qwj2) |
| `csv-parse@5.6.0` | Moderate | [Column-path prototype replacement](https://github.com/advisories/GHSA-8cw4-87c7-c6xx) |
| `uuid@9.0.1` | Moderate | [v3/v5/v6 buffer bounds](https://github.com/advisories/GHSA-w5hq-g745-h8pq) |
| `@opentelemetry/instrumentation-pg@0.52.0` | Moderate | [Database-username span disclosure](https://github.com/advisories/GHSA-qqmp-wf37-98f9) |
| `postcss-selector-parser@6.1.4` | Moderate | [Selector parsing CPU exhaustion](https://github.com/advisories/GHSA-rj75-hqrm-r3gf) |
| `sprintf-js@1.0.3` | Moderate | [Precision-specifier DoS](https://github.com/advisories/GHSA-hp3w-g68c-fv3c) |

The two High advisories above have different exposure requirements. The
reviewed `braces` advisory currently lists **no patched version**; it requires
attacker-controlled deeply nested brace patterns, so dependency presence is
not sufficient evidence of an HTTP exploit. Trace the pattern-input paths
before accepting that residual risk.

The Vite Windows bypass requires an exposed Vite development server and a
sensitive file in an allowed directory on NTFS/Windows. This specific issue
does not describe the Linux production host, but that does not clear the
other Vite advisories or justify exposing a Windows development server.

Keep development servers private, admin authentication enabled and the
origin firewall in place. These controls do not remove the advisories or
replace review of their input paths. Production deployment has not been
performed by this check; apply the checkout-access migration and deploy
the backend and storefront together in a controlled window.
