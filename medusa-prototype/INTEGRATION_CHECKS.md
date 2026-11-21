# External integration checks

Credentials must stay in `apps/backend/.env.integrations.local`. The file is
ignored by Git. Never paste credentials into issues, commits, CI logs, or chat.

## CDEK

Use the EDU base URL only with sandbox credentials. Credentials issued for a
live CDEK account use the production URL:

```dotenv
CDEK_CLIENT_ID=...
CDEK_CLIENT_SECRET=...
CDEK_API_BASE_URL=https://api.cdek.ru/v2
CDEK_FROM_CITY_CODE=... # confirmed city of dispatch
```

Run the read-only check from the repository root:

```bash
npm run integrations:check:cdek
```

The command sends OAuth credentials in the POST body (never in a URL) and
prints only the HTTP status on failure, not the carrier's response body.
On the tested production endpoint, Node's default User-Agent received HTTP 403.
The check and the backend CDEK client send explicit application User-Agent headers.
It then reads the configured origin/destination cities and calculates tariffs
136 (pickup) and 137 (courier) for an illustrative parcel. With the production
URL and live keys, success proves authentication and sample tariff access; it
does **not** validate real product dimensions, create a shipment, verify the
customer checkout, or arrange courier intake. Confirm the origin city before
running the check. Keep these keys separate from old EDU credentials in
`apps/backend/.env`.

The city code is sufficient only for a diagnostic tariff calculation.
Configure one or more actual staff-dropoff PVZ in Admin → «Пункты сдачи» for
the source warehouse, including each point's CDEK city code and one active
default. Checkout and booking resolve this native address-metadata allowlist,
not a global sender-point environment variable. The provider verifies
`is_reception=true`, type `PVZ`, code and city through CDEK's read-only API.
The chosen point becomes `shipment_point`; destination and source are distinct.
Missing/disabled origins block paid preparation/booking, not standalone quotes.

Each separately packed unit is one entry in `packages`; quantity 2 is two places,
not a larger invented box. Checkout charges the configured fixed buyer fee once
per order. The application's limit is 100 total places. The public
`POST /store/cdek/calculate` accepts
`{to_city_code, tariff_code?, packages:[{weight,length,width,height}]}`;
the former flat single-parcel request is no longer accepted. This public quote
does not set a cart's paid shipping data: the native shipping workflow derives
and validates the manifest from actual cart variants before payment.

## T-Bank

T-Bank supports two different test flows:

- A test terminal with the `DEMO` suffix uses the regular API URL.
- A live terminal without the `DEMO` suffix uses the isolated test API URL and
  requires the server IP to be allow-listed.

For a `DEMO` terminal:

```dotenv
TBANK_TERMINAL_KEY=...DEMO
TBANK_PASSWORD=...
TBANK_API_BASE_URL=https://securepay.tinkoff.ru/v2
```

For a live terminal in the isolated test environment:

```dotenv
TBANK_TERMINAL_KEY=...
TBANK_PASSWORD=...
TBANK_API_BASE_URL=https://rest-api-test.tinkoff.ru/v2
```

Run the signed read-only request:

```bash
npm run integrations:check:tbank
```

The command calls `CheckOrder` with a unique non-existent order id. Missing-order
codes such as `335` or `914` are expected and prove that the terminal and request
signature were accepted. Codes `204`, `205`, `501`, or `2015` mean that the
terminal, password, environment, or signature is invalid.

T-Bank requires the caller IP to be allow-listed for the isolated test environment.
Production backend requests originate from `5.42.97.122`; ask T-Bank support to
allow that IP for `rest-api-test.tinkoff.ru`. An nginx `403` is the expected
response until the allow-list is updated.

The repository contains the public CA certificates recommended by T-Bank. The
production Docker image installs them and configures Node to use the resulting
system CA bundle. TLS verification must never be disabled as a workaround.

## Yandex Delivery

Use a Yandex Delivery Platform API token, the confirmed station ID of the
actual self-dropoff source and an agreed positive fixed buyer price.
Staff collect the items and deliver the parcel to the carrier themselves;
do not configure courier collection from a shop for this agreed workflow.
An empty `warehouses/list` response does not rule out self-dropoff at a PVZ.
Use the test host only with credentials enabled for that environment.

```dotenv
YANDEX_DELIVERY_ENABLED=true
YANDEX_DELIVERY_TOKEN=...
YANDEX_CHECK_SOURCE_STATION_ID=... # read-only script below, not backend routing
# Agreed fixed buyer fee; carrier quote remains separate.
YANDEX_DELIVERY_PVZ_PRICE_RUB=350
YANDEX_DELIVERY_API_BASE_URL=https://b2b-authproxy.taxi.yandex.net/api/b2b/platform
```

For self-dropoff, query `pickup-points/list` with `available_for_dropoff: true`.
Add confirmed accepting station IDs/addresses to Admin → «Пункты сдачи» for
the source warehouse and select one default. For the read-only script only,
set `YANDEX_CHECK_SOURCE_STATION_ID` to the point being diagnosed.
The destination PVZ list also contains receive-only points; do not use an
arbitrary receiving PVZ as the source or infer dropoff support from that list.

The buyer's receiving PVZ is independent of the sender station. Checkout
charges the configured `YANDEX_DELIVERY_PVZ_PRICE_RUB`, not the live
`self_pickup` quote. Carrier quotes remain separate in validated shipping and
fulfillment data. A missing or zero buyer fee is a configuration error, not a
free-delivery fallback. If the carrier quote is unavailable or the cart's
charged shipping differs from the displayed buyer fee, do not redirect to payment.
The public calculation response contains `customer_cost`, `currency` and,
when returned by the carrier, `delivery_days`; the old raw `price` is removed.
The backend supports several permitted sources per native warehouse.
Staff consolidate goods at Мосмарт and select the actual allowed source when
creating the native fulfillment. Pricing and offers use the same selected
source ID. A changed default cannot redirect an existing order; its saved
origin must remain active or staff must explicitly choose an allowed alternate.
Each individually packaged unit remains its own place, including quantity > 1.
A live illustrative quote does not verify real product measurements or shipment.

Read-only recheck on 2026-10-19: `warehouses/list` with `{"filter":{}}`
returned HTTP 200 and an empty `warehouses` array. This is **not** proof that
self-dropoff is unavailable: `pickup-points/list` with `geo_id: 213`,
`operator_ids: ["market_l4g"]` and `available_for_dropoff: true` returned
HTTP 200 and 1,747 accepting points. Staff must choose the actual point after
consolidating the order; no station was assigned and no shipment was created
by this check. At that time the running backend had Yandex disabled and no
source configured. Current code uses native source-address metadata instead of
a global station variable; keep checkout closed until configuration and real
parcel acceptance are verified.

Local recheck on 2026-11-04: the staff-selected point at Москва, улица
Татьянин Парк, 19 к2, 119618 (`019c46a98d5c760592bd443671c97358`)
appeared in the authenticated `available_for_dropoff: true` response. A
read-only illustrative calculation from that point succeeded; it is not a
shipment or confirmation of the actual packaged order. The Yandex fulfillment
provider is registered with `ModuleProvider`, matching Medusa's provider
contract. With the provider enabled, isolated database migrations and a local
backend startup succeeded. A demo cart returned HTTP 200 from the local
calculation route, and the browser selected a buyer pickup point and displayed
the 350 RUB fee. The isolated local checkout uses demo product measurements and
a placeholder buyer fee; neither is a confirmed production value. Local
integration credentials remain outside Git. No shipment, payment or production
change was made.


Run the read-only check from the repository root:

```bash
npm run integrations:check:yandex
```

The command looks up Moscow, lists Yandex Market pickup points, and calculates
`self_pickup` pricing for an explicitly illustrative parcel (1 kg, 20×15×10 cm).
It does not validate real product measurements, create an offer, confirm a
shipment, or verify production access when pointed at a test host.

## Russian Post (Почта России)

Use the Otpravka API credentials issued in `otpravka.pochta.ru`:

```dotenv
POCHTA_ACCESS_TOKEN=...
POCHTA_USER_KEY=...
POCHTA_API_BASE_URL=https://otpravka-api.pochta.ru/1.0
POCHTA_FROM_INDEX=... # confirmed postcode of dispatch
```

Run the read-only check from the repository root:

```bash
npm run integrations:check:pochta
```

The command calculates tariffs for "Посылка онлайн" and "Курьер онлайн" between
Moscow and Saint Petersburg. It does not create batch orders or barcodes.

Official references:

- https://developer.tbank.ru/eacq/intro/errors/test
- https://developer.tbank.ru/eacq/intro/errors/test-cases
- https://developer.tbank.ru/eacq/intro/certificates/
- https://developer.tbank.ru/eacq/api/check-order
- https://developer.tbank.ru/eacq/intro/developer/token
- https://yandex.ru/support/delivery-profile/ru/api/other-day/ref/
- https://otpravka.pochta.ru/specification
