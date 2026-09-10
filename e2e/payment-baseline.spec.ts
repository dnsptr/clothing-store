import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

import {
  BANK_PAYMENT_URL,
  DEFAULT_APP_URL,
  DEFAULT_FIXTURE_URL,
  type PaymentScenario,
} from "./fixtures/payment-baseline";

const APP_URL = process.env.PAYMENT_APP_URL ?? DEFAULT_APP_URL;
const FIXTURE_URL = process.env.PAYMENT_FIXTURE_URL ?? DEFAULT_FIXTURE_URL;
const EVIDENCE_DIRECTORY = resolve(".omo/evidence/payment-lifecycle-hardening/task-1");

const CART_ITEM = {
  product: {
    id: "baseline-coat",
    productId: "prod_baseline",
    handle: "mario-mikke-baseline-coat",
    name: "Baseline coat",
    price: 1899,
    category: "Outerwear",
    categorySlug: "outerwear",
    materialSlugs: [],
    availableSizes: ["M"],
    images: [],
    colors: [{ name: "Black", hex: "#111111" }],
    options: [{ title: "Размер", values: ["M"] }],
    variants: [{
      variantId: "variant_baseline",
      sku: "BASELINE-COAT-M",
      options: { Размер: "M", Цвет: "Black" },
      price: 1899,
      available: true,
    }],
    available: true,
  },
  selectedSize: "M",
  selectedColor: { name: "Black", hex: "#111111" },
  variantId: "variant_baseline",
  lineItemId: "item_baseline",
  unitPrice: 1899,
  lineTotal: 1899,
  quantity: 1,
} as const;

type ObservationResponse = {
  readonly observations: readonly { readonly method: string; readonly path: string }[];
};

async function configureScenario(request: APIRequestContext, scenario: PaymentScenario): Promise<void> {
  const reset = await request.post(`${FIXTURE_URL}/__control/reset`);
  expect(reset.ok()).toBe(true);
  const configured = await request.post(`${FIXTURE_URL}/__control/scenario`, { data: { scenario } });
  expect(configured.ok()).toBe(true);
}

async function observations(request: APIRequestContext): Promise<ObservationResponse> {
  const response = await request.get(`${FIXTURE_URL}/__control/observations`);
  expect(response.ok()).toBe(true);
  const value: unknown = await response.json();
  if (!value || typeof value !== "object" || !("observations" in value) || !Array.isArray(value.observations)) {
    throw new TypeError("Invalid observation response from Store API fixture");
  }
  const parsed = value.observations.filter((item): item is { readonly method: string; readonly path: string } =>
    Boolean(item) && typeof item === "object" && "method" in item && typeof item.method === "string" &&
    "path" in item && typeof item.path === "string",
  );
  return { observations: parsed };
}

async function openCheckout(page: Page): Promise<void> {
  await page.addInitScript((cartItem) => {
    window.localStorage.setItem("clothing-store-cart-medusa", JSON.stringify([cartItem]));
    window.localStorage.setItem("clothing-store-medusa-cart", "cart_baseline");
  }, CART_ITEM);
  await page.goto(`${APP_URL}/checkout`);
  await expect(page.locator('input[name="firstName"]')).toBeVisible();
  await expect(page.locator('input[name="shippingOption"]')).toBeChecked();
}

async function submitCheckout(page: Page): Promise<void> {
  await page.locator('input[name="firstName"]').fill("Anna");
  await page.locator('input[name="lastName"]').fill("Ivanova");
  await page.locator('input[name="email"]').fill("anna@example.test");
  await page.locator('input[name="phone"]').fill("+79990000000");
  await page.locator('input[name="city"]').fill("Moscow");
  await page.locator('input[name="zip"]').fill("123456");
  await page.locator('input[name="address"]').fill("Tverskaya 1");
  await page.locator('input[type="checkbox"]').check();
  await page.getByRole("button", { name: "Подтвердить заказ" }).click();
}

async function expectNoCartCompletion(request: APIRequestContext): Promise<void> {
  const captured = await observations(request);
  expect(captured.observations).toEqual(expect.arrayContaining([
    expect.objectContaining({ method: "POST", path: "/store/payment-collections" }),
    expect.objectContaining({ method: "POST", path: "/store/payment-collections/paycol_baseline/payment-sessions" }),
  ]));
  expect(captured.observations.some(({ path }) => path === "/store/carts/cart_baseline/complete")).toBe(false);
}

test.beforeAll(async () => {
  await mkdir(EVIDENCE_DIRECTORY, { recursive: true });
});

test("real checkout redirects a valid pending provider session without completing the cart", async ({ page, request }) => {
  // Given
  await configureScenario(request, "valid");
  await page.route(BANK_PAYMENT_URL, (route) => route.fulfill({
    contentType: "text/html",
    body: "<title>Bank fixture</title><main><h1>Bank payment boundary</h1></main>",
  }));
  await openCheckout(page);

  // When
  await submitCheckout(page);

  // Then
  await expect(page).toHaveURL(BANK_PAYMENT_URL);
  await expect(page.getByRole("heading", { name: "Bank payment boundary" })).toBeVisible();
  await expectNoCartCompletion(request);
  await page.screenshot({ path: resolve(EVIDENCE_DIRECTORY, "browser-valid-redirect.png"), fullPage: true });
});

for (const scenario of ["malformed", "missing", "insecure"] as const) {
  test(`real checkout keeps the shopper on checkout for ${scenario} payment URL data`, async ({ page, request }) => {
    // Given
    await configureScenario(request, scenario);
    await openCheckout(page);

    // When
    await submitCheckout(page);

    // Then
    await expect(page).toHaveURL(`${APP_URL}/checkout`);
    await expect(page.locator("p[role='alert']")).toBeVisible();
    await expectNoCartCompletion(request);
  });
}

for (const scenario of ["wrong_status", "wrong_provider"] as const) {
  test(`real checkout enforces ${scenario} payment session gating`, async ({ page, request }) => {
    // Given
    await configureScenario(request, scenario);
    await openCheckout(page);

    // When
    await submitCheckout(page);

    // Then
    await expect(page).toHaveURL(`${APP_URL}/checkout`);
    await expect(page.locator("p[role='alert']")).toBeVisible();
    await expectNoCartCompletion(request);
  });
}

test("bank no-return leaves no verified storefront result", async ({ page, request }) => {
  // Given
  await configureScenario(request, "valid");
  await page.route(BANK_PAYMENT_URL, (route) => route.fulfill({
    contentType: "text/html",
    body: "<title>Bank fixture</title><main><h1>Awaiting bank action</h1></main>",
  }));
  await openCheckout(page);

  // When
  await submitCheckout(page);

  // Then
  await expect(page).toHaveURL(BANK_PAYMENT_URL);
  await expect(page.getByRole("heading", { name: "Awaiting bank action" })).toBeVisible();
  await expectNoCartCompletion(request);
  expect((await request.get(`${APP_URL}/payment/success`)).status()).toBe(404);
  expect((await request.get(`${APP_URL}/payment/fail`)).status()).toBe(404);
});
