const { spawnSync } = require("node:child_process");

const host = process.env.DB_HOST ?? "localhost";
if (host !== "localhost" && host !== "127.0.0.1") {
  throw new Error("Offline checkout requires a loopback PostgreSQL host (DB_HOST=localhost)");
}
for (const key of ["DB_PORT", "DB_USERNAME", "DB_PASSWORD"]) {
  if (!process.env[key]) throw new Error(`Offline checkout requires ${key} for a local PostgreSQL user`);
}

const databaseUrl = new URL("postgresql://localhost/postgres");
databaseUrl.username = process.env.DB_USERNAME;
databaseUrl.password = process.env.DB_PASSWORD;
databaseUrl.port = process.env.DB_PORT;

const env = {
  ...process.env,
  NODE_ENV: "test",
  TEST_TYPE: "integration:http",
  NODE_OPTIONS: "--experimental-vm-modules",
  DB_HOST: "localhost", // Medusa's test runner uses non-SSL for this hostname.
  DATABASE_URL: databaseUrl.toString(),
  REDIS_URL: "",
  SMTP_HOST: "",
  SMTP_USER: "",
  SMTP_PASSWORD: "",
  SMTP_FROM: "",
  TELEGRAM_BOT_TOKEN: "",
  CDEK_ENABLED: "false",
  YANDEX_DELIVERY_ENABLED: "false",
  OWN_COURIER_ENABLED: "false",
  TBANK_ENABLED: "true",
  TBANK_PAYMENT_PROVIDER_ID: "pp_tbank_tbank",
  TBANK_TERMINAL_KEY: "TinkoffBankTest",
  TBANK_PASSWORD: "TinkoffBankTest",
  TBANK_RECEIPT_SNAPSHOT_SECRET: "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=",
  TBANK_API_BASE_URL: "https://rest-api-test.tinkoff.ru/v2",
  TBANK_SUCCESS_URL: "https://mariomikke.shop/checkout/success",
  TBANK_FAIL_URL: "https://mariomikke.shop/checkout/fail",
  TBANK_NOTIFICATION_URL: "https://api.mariomikke.shop/hooks/payment/tbank",
};
delete env.PORT;

const result = spawnSync(process.execPath, [
  require.resolve("jest/bin/jest"),
  "--runInBand", "--runTestsByPath", "integration-tests/http/checkout-tbank.spec.ts",
  "--silent", "--forceExit",
], { env, stdio: "inherit" });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
