import { spawn, type ChildProcess } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { medusaIntegrationTestRunner } from "@medusajs/test-utils";
import { ContainerRegistrationKeys, ProductStatus } from "@medusajs/framework/utils";
import {
  createProductsWorkflow,
  createShippingOptionsWorkflow,
  createShippingProfilesWorkflow,
} from "@medusajs/medusa/core-flows";
import { chromium, expect as expectBrowser, type Browser } from "@playwright/test";

import seedInitialData from "../../src/migration-scripts/initial-data-seed";
import { TBANK_NOTIFICATION_MODULE } from "../../src/modules/tbank-notifications";
import { generateToken } from "../../src/modules/tbank/lib/token";

jest.setTimeout(240_000);

const describeBrowser = process.env.BROWSER_CHECKOUT_TEST === "true" ? describe : describe.skip;
const BANK_URL = "https://securepay.tinkoff.ru/payment/offline-browser-checkout";
const SITE_PORT = Number(process.env.BROWSER_CHECKOUT_PORT ?? "4183");
const SITE_URL = `http://127.0.0.1:${SITE_PORT}`;
const REPOSITORY_ROOT = resolve(process.cwd(), "../../..");

async function startStorefront(backendUrl: string, publishableKey: string, regionId: string): Promise<ChildProcess> {
  const hostname = new URL(backendUrl).hostname;
  if (hostname !== "localhost" && hostname !== "127.0.0.1") {
    throw new Error("Offline browser checkout refuses a non-local Medusa backend");
  }
  const child = spawn(process.execPath, [resolve(REPOSITORY_ROOT, "node_modules/next/dist/bin/next"),
    "dev", "--hostname", "127.0.0.1", "--port", String(SITE_PORT)], {
    cwd: REPOSITORY_ROOT,
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      NODE_ENV: "development",
      NEXT_TELEMETRY_DISABLED: "1",
      DATA_MODE: "medusa",
      MEDUSA_BACKEND_URL: backendUrl,
      MEDUSA_PUBLISHABLE_KEY: publishableKey,
      MEDUSA_REGION_ID: regionId,
      NEXT_PUBLIC_DATA_MODE: "medusa",
      NEXT_PUBLIC_MEDUSA_BACKEND_URL: backendUrl,
      NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY: publishableKey,
      NEXT_PUBLIC_MEDUSA_REGION_ID: regionId,
      NEXT_PUBLIC_MEDUSA_PAYMENT_PROVIDER_ID: "pp_tbank_tbank",
      NEXT_PUBLIC_PAYMENT_POLL_INTERVAL_MS: "100",
      NEXT_PUBLIC_PAYMENT_POLL_MAX_ATTEMPTS: "100",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout?.on("data", (chunk: Buffer) => { output = (output + chunk.toString()).slice(-4_000); });
  child.stderr?.on("data", (chunk: Buffer) => { output = (output + chunk.toString()).slice(-4_000); });
  child.on("error", (error) => { output += `\n${error.message}`; });
  for (let attempt = 0; attempt < 200; attempt++) {
    if (child.exitCode !== null) throw new Error(`Next exited before readiness: ${output}`);
    try {
      const response = await fetch(`${SITE_URL}/checkout`, { signal: AbortSignal.timeout(2_000) });
      if (response.status < 500) return child;
    } catch { /* The server is still starting. */ }
    await delay(250);
  }
  child.kill();
  throw new Error(`Next did not become ready: ${output}`);
}

async function stopStorefront(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return;
  const exited = new Promise<void>((done) => child.once("exit", () => done()));
  child.kill();
  await Promise.race([exited, delay(5_000)]);
  if (child.exitCode === null) child.kill("SIGKILL");
}

describeBrowser("browser checkout against real Medusa and PostgreSQL (offline bank)", () => {
  medusaIntegrationTestRunner({
    testSuite: ({ api, getContainer }) => {
      it("creates one captured order after signed CONFIRMED and its replay, without a real bank request", async () => {
        const container = getContainer();
        const query = container.resolve(ContainerRegistrationKeys.QUERY);
        await seedInitialData({ container });
        await createShippingProfilesWorkflow(container).run({
          input: { data: [{ name: "Browser checkout", type: "default" }] },
        });
        const { data: [region] } = await query.graph({ entity: "region", fields: ["id", "currency_code"] });
        const { data: [salesChannel] } = await query.graph({ entity: "sales_channel", fields: ["id"] });
        const { data: [profile] } = await query.graph({ entity: "shipping_profile", fields: ["id"] });
        const { data: [fulfillmentSet] } = await query.graph({ entity: "fulfillment_set", fields: ["service_zones.id"] });
        const { data: [key] } = await query.graph({ entity: "api_key", fields: ["token"], filters: { type: "publishable" } });
        const headers = { "x-publishable-api-key": key.token };

        const { result: [product] } = await createProductsWorkflow(container).run({
          input: { products: [{
            title: "Браузерный тест оплаты",
            status: ProductStatus.PUBLISHED,
            shipping_profile_id: profile.id,
            sales_channels: [{ id: salesChannel.id }],
            options: [{ title: "Размер", values: ["M"] }],
            variants: [{ title: "M", sku: "browser-real-medusa-checkout", options: { Размер: "M" },
              prices: [{ currency_code: "rub", amount: 1899 }], manage_inventory: false }],
          }] },
        });
        const { data: [stored] } = await query.graph({
          entity: "product", fields: ["variants.id"], filters: { id: product.id },
        });
        await createShippingOptionsWorkflow(container).run({
          input: [{
            name: "Тестовая доставка", price_type: "flat", provider_id: "manual_manual",
            service_zone_id: fulfillmentSet.service_zones[0].id,
            shipping_profile_id: profile.id,
            type: { label: "Тестовая доставка", description: "Только изолированная БД", code: "browser-fixture" },
            prices: [{ currency_code: "rub", amount: 0 }],
            rules: [
              { attribute: "enabled_in_store", value: "true", operator: "eq" },
              { attribute: "is_return", value: "false", operator: "eq" },
            ],
          }],
        });
        const cart = await api.post("/store/carts", { region_id: region.id }, { headers });
        const cartId = cart.data.cart.id as string;
        await api.post(`/store/carts/${cartId}/line-items`, {
          variant_id: stored.variants[0].id, quantity: 1,
        }, { headers });

        const backendUrl: unknown = api.defaults.baseURL;
        if (typeof backendUrl !== "string") throw new Error("Medusa test server has no HTTP baseURL");
        const originalFetch = global.fetch;
        const bankCalls: string[] = [];
        let bankStatus = "NEW";
        const bankPaymentId = "3456789";
        let bankOrderId = "";
        const bank = jest.spyOn(global, "fetch").mockImplementation(async (input, options) => {
          const url = String(input);
          if (url.startsWith("https://rest-api-test.tinkoff.ru/v2/")) {
            const method = url.slice(url.lastIndexOf("/") + 1);
            if (method !== "Init" && method !== "GetState") throw new Error(`Unexpected bank operation: ${method}`);
            bankCalls.push(method);
            const request = JSON.parse(String(options?.body)) as { Amount?: number; OrderId?: string };
            if (method === "Init") bankOrderId = request.OrderId ?? "";
            return {
              ok: true, status: 200,
              json: async () => ({ Success: true, ErrorCode: "0", TerminalKey: "TinkoffBankTest",
                PaymentId: bankPaymentId, PaymentURL: BANK_URL, Status: bankStatus,
                ...(request.Amount === undefined ? {} : { Amount: request.Amount }),
                ...(request.OrderId === undefined ? {} : { OrderId: request.OrderId }) }),
            } as Response;
          }
          const hostname = new URL(url).hostname;
          if (hostname === "localhost" || hostname === "127.0.0.1") return originalFetch(input, options);
          throw new Error(`Offline checkout refused an unexpected external request: ${hostname}`);
        });

        let next: ChildProcess | undefined;
        let browser: Browser | undefined;
        try {
          next = await startStorefront(backendUrl, key.token, region.id);
          browser = await chromium.launch({ headless: true });
          const page = await browser.newPage();
          await page.route(BANK_URL, (route) => route.fulfill({
            contentType: "text/html", body: "<title>Offline bank</title><main><h1>Bank payment boundary</h1></main>",
          }));
          await page.addInitScript((id) => {
            window.localStorage.setItem("clothing-store-medusa-cart", id);
          }, cartId);
          await page.goto(`${SITE_URL}/checkout`);
          await expectBrowser(page.getByRole("heading", { name: "Оформление заказа" })).toBeVisible();
          await expectBrowser(page.locator('input[name="shippingOption"]')).toBeChecked({ timeout: 20_000 });
          await page.locator('input[name="firstName"]').fill("Тест");
          await page.locator('input[name="lastName"]').fill("Покупатель");
          await page.locator('input[name="email"]').fill("browser-checkout@example.test");
          await page.locator('input[name="phone"]').fill("+79991234567");
          await page.locator('input[name="city"]').fill("Москва");
          await page.locator('input[name="zip"]').fill("101000");
          await page.locator('input[name="address"]').fill("Тестовая, 1");
          await page.locator('input[type="checkbox"]').check();
          await page.getByRole("button", { name: "Подтвердить заказ" }).click();
          await expectBrowser(page).toHaveURL(BANK_URL, { timeout: 30_000 });
          await expectBrowser(page.getByRole("heading", { name: "Bank payment boundary" })).toBeVisible();
          const evidence = resolve(REPOSITORY_ROOT, "test-results");
          await mkdir(evidence, { recursive: true });
          await page.screenshot({ path: resolve(evidence, "real-medusa-bank-boundary.png") });
          expect(bankCalls.filter((method) => method === "Init")).toHaveLength(1);
          expect(bankOrderId).not.toBe("");
          const pending = await api.get(`/store/payment-status/${cartId}`, { headers });
          expect(pending.data).toEqual({ payment: "pending", order: "pending" });

          bankStatus = "CONFIRMED";
          const sessionId = bankOrderId;
          const paymentCollection = await api.get(`/store/carts/${cartId}`, { headers });
          const amountKopecks = Math.round(Number(paymentCollection.data.cart.total) * 100);
          const notification: Record<string, unknown> = {
            TerminalKey: "TinkoffBankTest", OrderId: sessionId,
            PaymentId: Number(bankPaymentId), Status: "CONFIRMED", Amount: amountKopecks, Success: true,
          };
          notification.Token = generateToken(notification, "TinkoffBankTest");
          expect((await api.post("/hooks/payment/tbank", notification)).data).toBe("OK");
          const inbox = container.resolve(TBANK_NOTIFICATION_MODULE) as {
            listTbankNotifications(filters: Record<string, string>): Promise<readonly { lifecycle_state: string }[]>;
            listTbankPaymentAttempts(filters: Record<string, string>): Promise<readonly { id: string }[]>;
          };
          let processed = false;
          for (let attempt = 0; attempt < 100; attempt++) {
            const rows = await inbox.listTbankNotifications({ payment_id: bankPaymentId, status: "CONFIRMED" });
            if (rows[0]?.lifecycle_state === "processed") { processed = true; break; }
            await delay(200);
          }
          expect(processed).toBe(true);
          expect((await api.post("/hooks/payment/tbank", notification)).data).toBe("OK");

          const { data: orders } = await query.graph({
            entity: "order_cart", fields: ["order_id", "cart_id"], filters: { cart_id: cartId },
          });
          const { data: payments } = await query.graph({
            entity: "payment", fields: ["id", "payment_session_id", "captured_at"], filters: { payment_session_id: sessionId },
          });
          expect(orders).toHaveLength(1);
          expect(payments).toHaveLength(1);
          expect(payments[0].captured_at).toBeTruthy();
          expect(await inbox.listTbankPaymentAttempts({ payment_session_id: sessionId })).toHaveLength(1);
          expect(await inbox.listTbankNotifications({ payment_id: bankPaymentId, status: "CONFIRMED" })).toHaveLength(1);
          expect(bankCalls.filter((method) => method === "Init")).toHaveLength(1);
          expect((await api.get(`/store/payment-status/${cartId}`, { headers })).data)
            .toEqual({ payment: "confirmed", order: "ready" });

          await page.goto(`${SITE_URL}/checkout/success?PaymentId=${bankPaymentId}&Status=CONFIRMED`);
          await expectBrowser(page.getByRole("heading", { name: "Оплата прошла успешно! Заказ оформлен." }))
            .toBeVisible({ timeout: 15_000 });
          await expectBrowser(page).toHaveURL(`${SITE_URL}/checkout/success`);
          expect(await page.evaluate(() => window.localStorage.getItem("clothing-store-medusa-cart"))).toBeNull();
          await page.screenshot({ path: resolve(evidence, "real-medusa-confirmed-order.png") });
        } finally {
          await browser?.close();
          if (next) await stopStorefront(next);
          bank.mockRestore();
        }
      });
    },
  });
});
