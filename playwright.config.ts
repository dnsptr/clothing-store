import { defineConfig } from "@playwright/test";

const externalAppUrl = process.env.PAYMENT_APP_URL;
const appUrl = externalAppUrl ?? "http://127.0.0.1:4173";

export default defineConfig({
  testDir: "./e2e",
  timeout: 120_000,
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  reporter: "line",
  webServer: externalAppUrl ? undefined : {
    command: "node --import ./medusa-prototype/node_modules/tsx/dist/loader.mjs e2e/fixtures/payment-baseline.ts --api-port 4174 --app-port 4173",
    url: `${appUrl}/checkout`,
    timeout: 180_000,
    reuseExistingServer: false,
  },
  use: {
    baseURL: appUrl,
    browserName: "chromium",
    trace: "retain-on-failure",
  },
});
