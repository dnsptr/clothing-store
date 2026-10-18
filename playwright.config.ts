import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { defineConfig } from "@playwright/test";

const externalAppUrl = process.env.PAYMENT_APP_URL;
const appUrl = externalAppUrl ?? "http://127.0.0.1:4173";
const fixtureLoader = externalAppUrl ? undefined : pathToFileURL(
  createRequire(resolve(process.cwd(), "medusa-prototype/apps/backend/package.json")).resolve("tsx"),
).href;

export default defineConfig({
  testDir: "./e2e",
  timeout: 120_000,
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  reporter: "line",
  webServer: externalAppUrl ? undefined : {
    command: `node --import "${fixtureLoader}" e2e/fixtures/payment-baseline.ts --api-port 4174 --app-port 4173`,
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
