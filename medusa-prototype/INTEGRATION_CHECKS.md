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

Official references:

- https://developer.tbank.ru/eacq/intro/errors/test
- https://developer.tbank.ru/eacq/intro/errors/test-cases
- https://developer.tbank.ru/eacq/intro/certificates/
- https://developer.tbank.ru/eacq/api/check-order
- https://developer.tbank.ru/eacq/intro/developer/token
