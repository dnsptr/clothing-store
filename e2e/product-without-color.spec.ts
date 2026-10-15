import { expect, test } from "@playwright/test";

import { BANK_PAYMENT_URL, DEFAULT_APP_URL, DEFAULT_FIXTURE_URL } from "./fixtures/payment-baseline";

const APP_URL = process.env.PAYMENT_APP_URL ?? DEFAULT_APP_URL;
const FIXTURE_URL = process.env.PAYMENT_FIXTURE_URL ?? DEFAULT_FIXTURE_URL;
const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type,x-publishable-api-key" };

test("a purchasable Medusa product without a color option reaches bank payment", async ({ page, request }) => {
  const reset = await request.post(`${FIXTURE_URL}/__control/reset`);
  expect(reset.ok()).toBe(true);
  let addedVariants = 0;

  await page.route("**/store/carts", (route) => {
    if (route.request().method() !== "POST") return route.continue();
    return route.fulfill({ headers: CORS, json: { cart: { id: "cart_colorless", items: [] } } });
  });
  await page.route("**/store/carts/cart_colorless/line-items", (route) => {
    expect(route.request().postDataJSON()).toEqual({ variant_id: "variant_baseline", quantity: 1 });
    addedVariants++;
    return route.fulfill({ headers: CORS, json: { cart: {
      id: "cart_colorless", total: 1899, subtotal: 1899, shipping_total: 0, tax_total: 0, discount_total: 0,
      items: [{ id: "item_colorless", title: "Baseline coat", variant_id: "variant_baseline",
        variant_sku: "BASELINE-COAT-M", variant_title: "M", product_id: "prod_baseline",
        product_title: "Baseline coat", product_handle: "mario-mikke-baseline-coat",
        quantity: 1, unit_price: 1899, total: 1899 }],
    } } });
  });
  await page.route(BANK_PAYMENT_URL, (route) => route.fulfill({
    contentType: "text/html", body: "<title>Bank fixture</title><main><h1>Bank payment boundary</h1></main>",
  }));

  await page.goto(`${APP_URL}/product/baseline-coat`);
  await expect(page.getByRole("heading", { name: "Baseline coat" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Выбрать цвет/ })).toHaveCount(0);
  const add = page.getByRole("button", { name: "Добавить в корзину" });
  await expect(add).toBeEnabled();
  await add.click();
  await expect.poll(() => addedVariants).toBe(1);

  await page.goto(`${APP_URL}/cart`);
  await expect(page.getByText("Baseline coat").first()).toBeVisible();
  await page.getByRole("link", { name: "Оплатить заказ" }).click();
  await page.locator('input[name="firstName"]').fill("Anna");
  await page.locator('input[name="lastName"]').fill("Ivanova");
  await page.locator('input[name="email"]').fill("anna@example.test");
  await page.locator('input[name="phone"]').fill("+79990000000");
  await page.locator('input[name="city"]').fill("Москва");
  await page.locator('input[name="zip"]').fill("101000");
  await page.locator('input[name="address"]').fill("ул. Тверская, д. 1");
  await page.locator('input[type="checkbox"]').check();
  await page.getByRole("button", { name: "Подтвердить заказ" }).click();
  await expect(page).toHaveURL(BANK_PAYMENT_URL);
  await expect(page.getByRole("heading", { name: "Bank payment boundary" })).toBeVisible();
});
