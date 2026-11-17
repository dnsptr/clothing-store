# 1C CommerceML Receiver: Dry Run

This is a catalog receiver, not a working catalog synchronization. It never calls
product, price, inventory, order, payment or fulfillment services.

## Protocol

Endpoint: `/integrations/onec` (HTTPS in production).

The implementation follows the catalog handshake in the
[official 1C protocol](https://v8.1c.ru/tekhnologii/obmen-dannymi-i-integratsiya/standarty-i-formaty/protokol-obmena-s-saytom/).

| Request | Result |
| --- | --- |
| GET `?type=catalog&mode=checkauth` | Separate HTTP Basic credentials; three-line `success`, cookie name, random cookie token |
| GET `?type=catalog&mode=init` | `zip=no` and `file_limit=1048576`; requires session cookie |
| POST `?type=catalog&mode=file&filename=import.xml` | Appends raw bytes to a private session file |
| GET `?type=catalog&mode=import&filename=import.xml` | Validates XML and stores a summary and SHA-256; does not import business data |
| GET `?type=catalog&mode=complete` | Optional completion acknowledgement after every file is validated |

Errors start with `failure` and use an appropriate HTTP error status.
Orders (`type=sale`), ZIP, media files, nested paths and non-XML files are rejected.
The root must be `КоммерческаяИнформация` with a 2.x schema version. This is
well-formedness/basic envelope validation, not full CommerceML XSD or business
validation. UTF-8 and Windows-1251 are supported; DTDs and external entities are
not. Summary warehouse counts count XML elements, not distinct warehouse IDs.

## Configuration

Only backend secrets are needed; never create NEXT_PUBLIC or VITE variables for
these credentials and never reuse the admin password.

- `ONEC_EXCHANGE_ENABLED=false` by default.
- `ONEC_EXCHANGE_USER`: separate exchange username.
- `ONEC_EXCHANGE_PASSWORD`: generated random secret, at least 32 characters.
- `ONEC_EXCHANGE_STORAGE_DIR`: private persistent directory; defaults to `var/onec`.

Production Compose mounts `./onec-data` to `/app/var/onec`. Prepare host ownership
for the container's uid/gid 1000, permissions 0700. The standard deployment script
prepares this directory. Do not place it inside `static`, `public`, or a directory
served by Caddy. Do not publish the spool or real XML fixtures to Git.

Changing credentials invalidates existing exchange sessions. Sessions expire after
two hours; files and journal records are retained for three days and cleaned during
authenticated session creation or journal access. Limits: 1 MiB/request, 8 MiB/file,
16 MiB/session, eight XML files/session, twenty retained sessions. These deliberately
small limits are for a single-product trial, not a scheduled production feed.

Writes use an exclusive filesystem lock across processes. Contention returns 503;
retry later. A process killed while holding the lock may leave `.lock`. An operator
must confirm there is no active exchange operation before removing this lock from
the configured private spool. Storage failures fail closed and do not affect the
store's catalog. Following an ambiguous interrupted upload, create a fresh session
and resend the complete file; the 1C protocol supplies no chunk offset/idempotency
key, so an identical retried chunk cannot safely be distinguished from real data.

## Admin Journal

`GET /admin/onec-exchange` uses normal Medusa admin authentication. The Integrations
page shows receipt/validation status, file sizes and record counts. No tokens,
passwords, spool paths, XML bodies or raw XML download routes are exposed.

## First Connection

Deploy the receiver and admin assets, configure separate credentials and the private
persistent mount, then enable the receiver. In UNF choose Other CMS, On site, and
the HTTPS receiver endpoint. Use a separate test exchange configuration with only
article 1916, no images, no orders and no schedule.

Do not point an existing production exchange at this dry-run receiver. A `success`
reply means the file passed validation, NOT that products were updated. 1C can mark
data as exported after this reply. When real synchronization is implemented, force
a complete export/reset exchange registration with the responsible 1C operator;
do not rely on incremental changes captured during dry runs.

Next: inspect actual XML, map stable product/variant/warehouse IDs, agree on the
warehouse allowlist and retail price type, then implement a reviewed dry-run diff
before enabling catalog writes. Prices, stock, reservations and checkout remain
unchanged throughout this phase.
