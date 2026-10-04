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
  await expect(page.getByRole("tab", { name: /Самовывоз/ })).toHaveAttribute("aria-selected", "true");
}

async function submitCheckout(page: Page): Promise<void> {
  await page.locator('input[name="firstName"]').fill("Anna");
  await page.locator('input[name="lastName"]').fill("Ivanova");
  await page.locator('input[name="email"]').fill("anna@example.test");
  await page.locator('input[name="phone"]').fill("+79990000000");
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

test("checkout ignores a previous own-courier check when a CDEK city suggestion changes the address", async ({ page, request }) => {
  await configureScenario(request, "valid");
  let checkedCity = "";
  const checkedCities: string[] = [];
  let releaseOldCheck: (() => void) | undefined;
  let oldCheckStarted = false;

  await page.route("**/store/carts/cart_baseline", async (route) => {
    if (route.request().method() === "POST") {
      const body: unknown = route.request().postDataJSON();
      if (body && typeof body === "object" && "shipping_address" in body) {
        const address = body.shipping_address;
        if (address && typeof address === "object" && "city" in address && typeof address.city === "string") {
          checkedCity = address.city;
          checkedCities.push(address.city);
        }
      }
    }
    await route.continue();
  });
  await page.route("**/store/shipping-options?**", async (route) => {
    const cityAtRequest = checkedCity;
    if (cityAtRequest === "Твер") {
      oldCheckStarted = true;
      await new Promise<void>((resolve) => { releaseOldCheck = resolve; });
    }
    await route.fulfill({
      headers: { "access-control-allow-origin": "*" },
      json: {
        shipping_options: [
          { id: "shipping_cdek", name: "СДЭК ПВЗ", type: { code: "cdek-pvz" }, amount: 0 },
          ...(cityAtRequest ? [{ id: "shipping_own", name: "Курьер по Москве", type: { code: "own-courier-mkad" }, amount: 0 }] : []),
        ],
      },
    });
  });
  await page.route("**/store/cdek/cities?**", (route) => route.fulfill({
    headers: { "access-control-allow-origin": "*" },
    json: { cities: [{ code: 69, city: "Тверь", region: "Тверская область" }] },
  }));
  await page.addInitScript((cartItem) => {
    window.localStorage.setItem("clothing-store-cart-medusa", JSON.stringify([cartItem]));
    window.localStorage.setItem("clothing-store-medusa-cart", "cart_baseline");
  }, CART_ITEM);
  await page.goto(`${APP_URL}/checkout`);
  await expect(page.locator('input[name="firstName"]')).toBeVisible();
  await expect(page.getByRole("tab", { name: /СДЭК ПВЗ/ })).toBeVisible();

  const ownCourierTab = page.getByRole("tab", { name: /Курьер по Москве/ });
  const checkDelivery = page.getByRole("button", { name: "Проверить доставку курьером" });
  await page.locator('input[name="zip"]').first().fill("123456");
  await page.locator('input[name="address"]').first().fill("Тверская 1");
  await checkDelivery.click();
  await expect(ownCourierTab).toBeVisible();

  const cdekCityInput = page.getByPlaceholder("Начните вводить город (напр. Москва, Санкт-Петербург)");
  await cdekCityInput.fill("Твер");
  await expect(ownCourierTab).toHaveCount(0);
  await expect(page.getByText("Тверь", { exact: true })).toBeVisible();
  await checkDelivery.click();
  await expect.poll(() => oldCheckStarted).toBe(true);
  await cdekCityInput.focus();
  await page.getByText("Тверь", { exact: true }).click();
  await expect(cdekCityInput).toHaveValue("Тверь");
  await expect(checkDelivery).toBeEnabled();
  const staleResponse = page.waitForResponse((response) =>
    response.url().includes("/store/shipping-options?") && response.status() === 200,
  );
  releaseOldCheck?.();
  await staleResponse;
  await page.evaluate(() => new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  ));
  expect(checkedCities).toEqual(["Москва", "Твер"]);
  await expect(ownCourierTab).toHaveCount(0);
});

test("Yandex checkout requires a chosen city and point, ignores a late old-city response, and sends the chosen station", async ({ page, request }) => {
  await configureScenario(request, "valid");
  const points = {
    moscow: [
      { id: "station_moscow_a", name: "Пункт Тверская", type: "pickup_point", address: { full_address: "Москва, Тверская, 7", city: "Москва" } },
      { id: "station_moscow_b", name: "Пункт Арбат", type: "terminal", address: { full_address: "Москва, Арбат, 10", city: "Москва" } },
    ],
    kazan: [
      { id: "station_kazan", name: "Пункт Баумана", type: "pickup_point", address: { full_address: "Казань, Баумана, 1", city: "Казань" } },
    ],
  };
  const shippingRequests: unknown[] = [];
  let releaseMoscow: (() => void) | undefined;
  let firstMoscowRequest = true;
  const cors = { "access-control-allow-origin": "*" };
  await page.route("**/store/shipping-options?**", (route) => route.fulfill({
    headers: cors,
    json: { shipping_options: [
      { id: "so_yandex_fixture", name: "Яндекс Маркет", type: { code: "yandex-pvz" }, amount: 0 },
      { id: "shipping_baseline", name: "Самовывоз", type: { code: "pickup-store" }, amount: 0 },
    ] },
  }));
  await page.route("**/store/yandex/cities?**", (route) => route.fulfill({
    headers: cors,
    json: { cities: [
      { geo_id: 213, city: "Москва" },
      { geo_id: 43, city: "Казань" },
    ] },
  }));
  await page.route("**/store/yandex/pvz?**", async (route) => {
    const geoId = new URL(route.request().url()).searchParams.get("geo_id");
    if (geoId === "213" && firstMoscowRequest) {
      firstMoscowRequest = false;
      await new Promise<void>((resolve) => { releaseMoscow = resolve; });
    }
    await route.fulfill({ headers: cors, json: { points: geoId === "213" ? points.moscow : points.kazan } });
  });
  await page.route("**/store/carts/cart_baseline/shipping-methods", async (route) => {
    shippingRequests.push(route.request().postDataJSON());
    await route.continue();
  });
  await page.route(BANK_PAYMENT_URL, (route) => route.fulfill({
    contentType: "text/html",
    body: "<title>Bank fixture</title><main><h1>Bank payment boundary</h1></main>",
  }));
  await page.addInitScript((cartItem) => {
    window.localStorage.setItem("clothing-store-cart-medusa", JSON.stringify([cartItem]));
    window.localStorage.setItem("clothing-store-medusa-cart", "cart_baseline");
  }, CART_ITEM);
  await page.goto(`${APP_URL}/checkout`);
  await expect(page.getByRole("tab", { name: /Яндекс Маркет/ })).toHaveAttribute("aria-selected", "true");
  const city = page.locator('input[name="yandexCity"]');
  await expect(city).toHaveValue("");
  await submitCheckout(page);
  await expect(page.getByText("Выберите город из списка", { exact: true })).toBeVisible();
  expect(shippingRequests).toHaveLength(0);

  await city.fill("Москва");
  await expect(page.getByText("Москва", { exact: true }).last()).toBeVisible();
  await page.getByText("Москва", { exact: true }).last().click();
  await expect.poll(() => releaseMoscow !== undefined).toBe(true);
  await city.fill("Казань");
  await expect(page.getByText("Казань", { exact: true }).last()).toBeVisible();
  await page.getByText("Казань", { exact: true }).last().click();
  await expect(page.getByText("Казань, Баумана, 1")).toBeVisible();
  const staleMoscowResponse = page.waitForResponse((response) =>
    response.url().includes("/store/yandex/pvz?geo_id=213") && response.status() === 200,
  );
  releaseMoscow?.();
  await staleMoscowResponse;
  await page.evaluate(() => new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  ));
  await expect(page.getByText("Москва, Арбат, 10")).toHaveCount(0);
  await page.getByRole("button", { name: "Подтвердить заказ" }).click();
  await expect(page.getByText("Выберите пункт выдачи Яндекс Маркет")).toBeVisible();
  expect(shippingRequests).toHaveLength(0);

  await page.getByText("Казань, Баумана, 1").click();
  await expect(page.getByText("Выбранный пункт Яндекс Маркет:")).toBeVisible();
  await city.fill("Москва");
  await expect(page.getByText("Выбранный пункт Яндекс Маркет:")).toHaveCount(0);
  await page.getByRole("button", { name: "Подтвердить заказ" }).click();
  expect(shippingRequests).toHaveLength(0);
  await page.getByText("Москва", { exact: true }).last().click();
  await expect(page.getByText("Москва, Арбат, 10")).toBeVisible();
  await page.getByText("Москва, Арбат, 10").click();
  await expect(page.getByText("Пункт Арбат", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Подтвердить заказ" }).click();
  await expect(page).toHaveURL(BANK_PAYMENT_URL);
  expect(shippingRequests).toEqual([{
    option_id: "so_yandex_fixture",
    data: {
      platform_station_id: "station_moscow_b",
      pvz_name: "Пункт Арбат",
      pvz_address: "Москва, Арбат, 10",
      city: "Москва",
      geo_id: 213,
      delivery_mode: "yandex-pvz",
    },
  }]);
});

test("Yandex checkout drops a chosen point on reload and distinguishes unavailable points from an empty city", async ({ page, request }) => {
  await configureScenario(request, "valid");
  const cors = { "access-control-allow-origin": "*" };
  const shippingRequests: unknown[] = [];
  let pointsUnavailable = false;
  await page.route("**/store/shipping-options?**", (route) => route.fulfill({
    headers: cors,
    json: { shipping_options: [
      { id: "so_yandex_fixture", name: "Яндекс Маркет", type: { code: "yandex-pvz" }, amount: 0 },
      { id: "shipping_baseline", name: "Самовывоз", type: { code: "pickup-store" }, amount: 0 },
    ] },
  }));
  await page.route("**/store/yandex/cities?**", (route) => route.fulfill({
    headers: cors,
    json: { cities: [{ geo_id: 213, city: "Москва" }, { geo_id: 43, city: "Казань" }] },
  }));
  await page.route("**/store/yandex/pvz?**", (route) => {
    if (pointsUnavailable) return route.fulfill({ status: 503, headers: cors, json: { message: "Unavailable" } });
    return route.fulfill({
      headers: cors,
      json: { points: new URL(route.request().url()).searchParams.get("geo_id") === "43" ? [] : [
        { id: "station_moscow", name: "Пункт Тверская", type: "pickup_point", address: { full_address: "Москва, Тверская, 7", city: "Москва" } },
      ] },
    });
  });
  await page.route("**/store/carts/cart_baseline/shipping-methods", async (route) => {
    shippingRequests.push(route.request().postDataJSON());
    await route.continue();
  });
  await page.addInitScript((cartItem) => {
    window.localStorage.setItem("clothing-store-cart-medusa", JSON.stringify([cartItem]));
    window.localStorage.setItem("clothing-store-medusa-cart", "cart_baseline");
  }, CART_ITEM);
  await page.goto(`${APP_URL}/checkout`);
  const city = page.locator('input[name="yandexCity"]');
  await city.fill("Москва");
  await page.getByText("Москва", { exact: true }).last().click();
  await page.getByText("Москва, Тверская, 7").click();
  await expect(page.getByText("Выбранный пункт Яндекс Маркет:")).toBeVisible();
  await page.reload();
  await expect(city).toHaveValue("");
  await expect(page.getByText("Выбранный пункт Яндекс Маркет:")).toHaveCount(0);
  await city.fill("Казань");
  await page.getByText("Казань", { exact: true }).last().click();
  await expect(page.getByText("В этом городе нет доступных пунктов выдачи Яндекс Маркет.")).toBeVisible();
  pointsUnavailable = true;
  await city.fill("Москва");
  await page.getByText("Москва", { exact: true }).last().click();
  await expect(page.getByRole("alert").filter({ hasText: "Не удалось загрузить пункты выдачи Яндекс Маркет" })).toBeVisible();
  await expect(page.getByText("В этом городе нет доступных пунктов выдачи Яндекс Маркет.")).toHaveCount(0);
  await submitCheckout(page);
  await expect(page.getByText("Выберите пункт выдачи Яндекс Маркет")).toBeVisible();
  expect(shippingRequests).toHaveLength(0);
});

test("CDEK checkout requires an explicit pickup point and ignores an older city search", async ({ page, request }) => {
  await configureScenario(request, "valid");
  const cors = { "access-control-allow-origin": "*" };
  const shippingRequests: unknown[] = [];
  let releaseOldCity: (() => void) | undefined;
  await page.route("**/store/shipping-options?**", (route) => route.fulfill({
    headers: cors,
    json: { shipping_options: [
      { id: "so_cdek", name: "СДЭК ПВЗ", type: { code: "cdek-pvz" }, amount: 0 },
      { id: "shipping_baseline", name: "Самовывоз", type: { code: "pickup-store" }, amount: 0 },
    ] },
  }));
  await page.route("**/store/cdek/cities?**", async (route) => {
    const query = new URL(route.request().url()).searchParams.get("query");
    if (query === "мос") await new Promise<void>((resolve) => { releaseOldCity = resolve; });
    await route.fulfill({
      headers: cors,
      json: { cities: query === "мос"
        ? [{ code: 44, city: "Москва", region: "Москва" }]
        : [{ code: 69, city: "Тверь", region: "Тверская область" }] },
    });
  });
  await page.route("**/store/cdek/pvz?**", (route) => {
    const cityCode = Number(new URL(route.request().url()).searchParams.get("city_code"));
    const point = cityCode === 44
      ? { code: "MSK1", name: "Московский ПВЗ", type: "PVZ", location: { address: "Москва, Арбат, 1", city_code: 44, city: "Москва" }, work_time: "09:00-21:00" }
      : { code: "TVR1", name: "Тверской ПВЗ", type: "PVZ", location: { address: "Тверь, Советская, 1", city_code: 69, city: "Тверь" }, work_time: "09:00-21:00" };
    return route.fulfill({ headers: cors, json: { pvz: [point] } });
  });
  await page.route("**/store/carts/cart_baseline/shipping-methods", async (route) => {
    shippingRequests.push(route.request().postDataJSON());
    await route.continue();
  });
  await page.route(BANK_PAYMENT_URL, (route) => route.fulfill({
    contentType: "text/html", body: "<main><h1>Bank payment boundary</h1></main>",
  }));
  await openCheckout(page);
  await expect(page.getByRole("tab", { name: /СДЭК ПВЗ/ })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByText("Москва, Арбат, 1")).toBeVisible();
  await submitCheckout(page);
  await expect(page.getByText("Выберите пункт выдачи СДЭК")).toBeVisible();
  expect(shippingRequests).toHaveLength(0);

  const city = page.getByPlaceholder("Начните вводить город (напр. Москва, Санкт-Петербург)");
  await city.fill("Мос");
  await expect.poll(() => releaseOldCity !== undefined).toBe(true);
  await city.fill("Твер");
  await expect(page.getByText("Тверь", { exact: true })).toBeVisible();
  const staleResponse = page.waitForResponse((response) =>
    response.url().includes("/store/cdek/cities?query=") && response.status() === 200 &&
    new URL(response.url()).searchParams.get("query") === "мос",
  );
  releaseOldCity?.();
  await staleResponse;
  await expect(page.locator('div[class*="cityOption"]').filter({ hasText: "Москва" })).toHaveCount(0);
  await page.getByText("Тверь", { exact: true }).click();
  await expect(page.getByText("Тверь, Советская, 1")).toBeVisible();
  await page.getByText("Тверь, Советская, 1").click();
  await page.getByRole("button", { name: "Подтвердить заказ" }).click();
  await expect(page).toHaveURL(BANK_PAYMENT_URL);
  expect(shippingRequests).toEqual([{ option_id: "so_cdek", data: {
    city_code: 69, cdek_pvz_code: "TVR1", cdek_pvz_address: "Тверской ПВЗ, Тверь, Советская, 1",
  } }]);
});

test("Russian Post checkout discards an old office when the index changes and requires its city", async ({ page, request }) => {
  await configureScenario(request, "valid");
  const cors = { "access-control-allow-origin": "*" };
  const sentAddresses: unknown[] = [];
  const shippingRequests: unknown[] = [];
  await page.route("**/store/shipping-options?**", (route) => route.fulfill({
    headers: cors,
    json: { shipping_options: [
      { id: "so_post", name: "Почта России", type: { code: "pochta-parcel" }, amount: 0 },
      { id: "shipping_baseline", name: "Самовывоз", type: { code: "pickup-store" }, amount: 0 },
    ] },
  }));
  await page.route("**/store/pochta/postoffices?**", (route) => {
    const index = new URL(route.request().url()).searchParams.get("postal_code");
    const office = index === "101000"
      ? { postal_code: "101000", address_source: "Москва, Мясницкая, 1" }
      : { postal_code: "190000", address_source: "Санкт-Петербург, Невский, 1" };
    return route.fulfill({ headers: cors, json: { offices: [office] } });
  });
  await page.route("**/store/carts/cart_baseline", async (route) => {
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON();
      if (body?.shipping_address) sentAddresses.push(body.shipping_address);
    }
    await route.continue();
  });
  await page.route("**/store/carts/cart_baseline/shipping-methods", async (route) => {
    shippingRequests.push(route.request().postDataJSON());
    await route.continue();
  });
  await page.route(BANK_PAYMENT_URL, (route) => route.fulfill({
    contentType: "text/html", body: "<main><h1>Bank payment boundary</h1></main>",
  }));
  await openCheckout(page);
  await expect(page.getByRole("tab", { name: /Почта РФ/ })).toHaveAttribute("aria-selected", "true");
  const zip = page.locator('input[name="zip"]').last();
  const city = page.locator('input[name="city"]').last();
  await zip.fill("101000");
  await expect(page.getByText("ОПС 101000", { exact: false })).toBeVisible();
  await submitCheckout(page);
  await expect(page.getByText("Выберите почтовое отделение связи")).toBeVisible();
  expect(sentAddresses).toHaveLength(0);
  await page.getByText("ОПС 101000", { exact: false }).click();
  await city.fill("Москва");
  await expect(page.getByText("Выбранное отделение Почты России:")).toBeVisible();

  await zip.fill("190000");
  await expect(page.getByText("Выбранное отделение Почты России:")).toHaveCount(0);
  await expect(page.getByText("ОПС 190000", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Подтвердить заказ" }).click();
  await expect(page.getByText("Выберите почтовое отделение связи")).toBeVisible();
  expect(sentAddresses).toHaveLength(0);
  await page.getByText("ОПС 190000", { exact: false }).click();
  await page.getByRole("button", { name: "Подтвердить заказ" }).click();
  await expect(page.getByText("Укажите город выбранного отделения")).toBeVisible();
  await city.fill("Санкт-Петербург");
  await page.getByRole("button", { name: "Подтвердить заказ" }).click();
  await expect(page).toHaveURL(BANK_PAYMENT_URL);
  expect(sentAddresses).toEqual([expect.objectContaining({
    city: "Санкт-Петербург", address_1: "Санкт-Петербург, Невский, 1", postal_code: "190000",
  })]);
  expect(shippingRequests).toEqual([{ option_id: "so_post", data: {
    postal_code: "190000", post_office_address: "Санкт-Петербург, Невский, 1",
  } }]);
});
