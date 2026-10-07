# External integration checks

Credentials must stay in `apps/backend/.env.integrations.local`. The file is
ignored by Git. Never paste credentials into issues, commits, CI logs, or chat.
The carrier quote commands require explicit measurements of one **packed**
order and a specified dispatch location; they no longer substitute a sample
parcel. In the ignored local environment file set:

```dotenv
DELIVERY_DISPATCH_INDEX=108811 # or 117574 (Принц Плаза), 119571 (Авеню)
DELIVERY_DISPATCH_ADDRESS=... # full confirmed physical address for this index
DELIVERY_WEIGHT_GRAMS=... # actual packed parcel
DELIVERY_LENGTH_CM=...
DELIVERY_WIDTH_CM=...
DELIVERY_HEIGHT_CM=...
DELIVERY_ASSESSED_PRICE_RUB=... # order item value, e.g. 3990.50
```

Run once per actual dispatch location and measured packing case. For mixed
orders measure the consolidated package. The command checks that the index is
one of the three confirmed **dispatch** points, not a pickup store. It cannot
verify that a manually supplied physical address or carrier origin ID belongs
to that point; confirm both independently before trusting the returned price.
No command enables a shipping method, takes payment or creates a shipment.


## CDEK

Use the EDU base URL only with sandbox credentials. Credentials issued for a
live CDEK account use the production URL:

```dotenv
CDEK_CLIENT_ID=...
CDEK_CLIENT_SECRET=...
CDEK_API_BASE_URL=https://api.cdek.ru/v2
CDEK_FROM_CITY_CODE=... # confirmed city of dispatch
CDEK_TO_CITY_CODE=... # explicit destination city for this quote
```

Run the read-only check from the repository root:

```bash
npm run integrations:check:cdek
```

The command obtains an OAuth token, reads the explicitly configured
origin/destination cities and calculates CDEK tariffs 136 (pickup) and 137
(courier) for the supplied measured parcel. A city code alone does not identify
the actual warehouse; reconcile the configured origin with the selected
physical dispatch point and 1C. The command does not create a CDEK order or
arrange courier intake.

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

Use a Yandex Delivery Platform API token and the confirmed platform station
ID of the dispatch warehouse; do not substitute a guessed address or station.
Use the test host only with credentials enabled for that environment.

```dotenv
YANDEX_DELIVERY_ENABLED=true
YANDEX_DELIVERY_TOKEN=...
YANDEX_DELIVERY_SOURCE_STATION_ID=...
YANDEX_DELIVERY_API_BASE_URL=https://b2b-authproxy.taxi.yandex.net/api/b2b/platform
```

Run the read-only check from the repository root:

```bash
npm run integrations:check:yandex
```

The command looks up Moscow, lists Yandex Market pickup points and calculates
`self_pickup` pricing for the supplied measured parcel to one of them.
Yandex delivery is paid by the buyer: a positive quote must appear in checkout,
the payment total and the fiscal receipt before enabling its shipping option.
The check does not create an offer, confirm a shipment, or verify production
access when pointed at a test host. Three dispatch points are known, but this
integration accepts one configured source station per run: reconcile that ID
with the actual physical dispatch address before trusting a quote. Re-run with
each confirmed station; do not guess an ID from its postal index.


Official references:

- https://developer.tbank.ru/eacq/intro/errors/test
- https://developer.tbank.ru/eacq/intro/errors/test-cases
- https://developer.tbank.ru/eacq/intro/certificates/
- https://developer.tbank.ru/eacq/api/check-order
- https://developer.tbank.ru/eacq/intro/developer/token
- https://yandex.ru/support/delivery-profile/ru/api/other-day/ref/
