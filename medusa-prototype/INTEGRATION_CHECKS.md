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
```

Run the read-only check from the repository root:

```bash
npm run integrations:check:cdek
```

The command obtains an OAuth token, reads the configured origin/destination
cities, and calculates tariffs for a sample parcel. It does not create a CDEK
order or courier intake.

## T-Bank

The test environment uses a live terminal without the `DEMO` suffix and the
test API base URL:

```dotenv
TBANK_TERMINAL_KEY=...
TBANK_PASSWORD=...
TBANK_API_BASE_URL=https://rest-api-test.tinkoff.ru/v2
```

Run the signed read-only request:

```bash
npm run integrations:check:tbank
```

The command calls `CheckOrder` with a unique non-existent order id. Error code
`914` (payment not found) is expected and proves that the terminal and request
signature were accepted. Codes `204`, `205`, or `2015` mean that the terminal,
password, or signature is invalid.

T-Bank requires the caller IP to be allow-listed for the test environment.
Production backend requests originate from `5.42.97.122`; ask T-Bank support to
allow that IP for `rest-api-test.tinkoff.ru`. An nginx `403` is the expected
response until the allow-list is updated.

The repository contains the public CA certificates recommended by T-Bank. The
production Docker image installs them and configures Node to use the resulting
system CA bundle. TLS verification must never be disabled as a workaround.

Official references:

- https://developer.tbank.ru/eacq/intro/errors/test
- https://developer.tbank.ru/eacq/intro/certificates/
- https://developer.tbank.ru/eacq/api/check-order
- https://developer.tbank.ru/eacq/intro/developer/token
