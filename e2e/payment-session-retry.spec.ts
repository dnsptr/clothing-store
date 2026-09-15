import { expect, test } from "@playwright/test";

import {
  DEFAULT_APP_URL,
  DEFAULT_FIXTURE_URL,
  SAMPLE_CART_ITEM,
  seedCart,
  resetFixture,
} from "./fixtures/payment-return";

const APP_URL = process.env.PAYMENT_APP_URL ?? DEFAULT_APP_URL;
const FIXTURE_URL = process.env.PAYMENT_FIXTURE_URL ?? DEFAULT_FIXTURE_URL;
const RETRY_CART_ID = "cart_01J00000000000000000000010";
const APPROVED_BANK_ROUTE = "https://securepay.tinkoff.ru/**";

async function fillCheckout(page: Parameters<typeof seedCart>[0]): Promise<void> {
  await page.locator('input[name="firstName"]').fill("Анна");
  await page.locator('input[name="lastName"]').fill("Петрова");
  await page.locator('input[name="email"]').fill("anna@example.com");
  await page.locator('input[name="phone"]').fill("+79990000000");
  await page.locator('input[name="city"]').fill("Москва");
  await page.locator('input[name="zip"]').fill("123456");
  await page.locator('input[name="address"]').fill("ул. Тверская, д. 1");
  await page.getByRole("checkbox").check();
}

async function paymentObservations(request: Parameters<typeof resetFixture>[0]) {
  const response = await request.get(`${FIXTURE_URL}/__control/observations`);
  expect(response.ok()).toBe(true);
  return response.json() as Promise<{
    readonly paymentSessionInitializations: number;
    readonly paymentSessions: readonly { readonly id: string; readonly status: string }[];
  }>;
}

async function configureScenario(
  request: Parameters<typeof resetFixture>[0],
  scenario: "valid" | "malformed" | "missing" | "insecure" | "wrong_provider" | "unapproved" | "credentials",
): Promise<void> {
  const response = await request.post(`${FIXTURE_URL}/__control/scenario`, { data: { scenario } });
  expect(response.ok()).toBe(true);
}

async function configureSession(
  request: Parameters<typeof resetFixture>[0],
  status: string,
): Promise<void> {
  const response = await request.post(`${FIXTURE_URL}/__control/payment-session`, { data: { status } });
  expect(response.ok()).toBe(true);
}

test.describe("Payment-session replay safety", () => {
  test.beforeEach(async ({ request }) => {
    await resetFixture(request, FIXTURE_URL);
    await configureScenario(request, "valid");
  });

  test("lost payment-session response is replayed in another tab without another provider initialization", async ({
    context,
    page,
    request,
  }) => {
    // Given: the provider accepted the first initialization, but its response is lost.
    await page.route(APPROVED_BANK_ROUTE, (route) => route.fulfill({ status: 200, body: "Bank form" }));
    await seedCart(page, RETRY_CART_ID, [SAMPLE_CART_ITEM]);
    await page.goto(`${APP_URL}/checkout`);
    await fillCheckout(page);
    const controlResponse = await request.post(`${FIXTURE_URL}/__control/payment-session`, {
      data: { dropNextResponse: true },
    });
    expect(controlResponse.ok()).toBe(true);

    // When: the first tab receives the network failure and the shopper retries in another tab.
    await page.getByRole("button", { name: "Подтвердить заказ" }).click();
    await expect(page.getByRole("alert")).toBeVisible();

    const retryPage = await context.newPage();
    await retryPage.route(APPROVED_BANK_ROUTE, (route) => route.fulfill({ status: 200, body: "Bank form" }));
    await retryPage.goto(`${APP_URL}/checkout`);
    await fillCheckout(retryPage);
    await retryPage.getByRole("button", { name: "Подтвердить заказ" }).click();
    await expect(retryPage).toHaveURL(/https:\/\/securepay\.tinkoff\.ru\/payment\/payses_fixture_1/);

    // Then: the persisted active session is reused instead of initializing T-Bank again.
    await expect.poll(() => paymentObservations(request)).toMatchObject({
      paymentSessionInitializations: 1,
      paymentSessions: [{ id: "payses_fixture_1", status: "pending_authorization" }],
    });
  });

  for (const status of ["authorized", "pending", "requires_more", "pending_authorization"] as const) {
    test(`reuses a ${status} session without another payment initialization`, async ({ page, request }) => {
      // Given: T-Bank already owns a nonterminal payment session.
      await page.route(APPROVED_BANK_ROUTE, (route) => route.fulfill({ status: 200, body: "Bank form" }));
      await seedCart(page, RETRY_CART_ID, [SAMPLE_CART_ITEM]);
      await configureSession(request, status);
      await page.goto(`${APP_URL}/checkout`);
      await fillCheckout(page);

      // When: checkout is replayed.
      await page.getByRole("button", { name: "Подтвердить заказ" }).click();

      // Then: the existing approved bank session is used directly.
      await expect(page).toHaveURL(/https:\/\/securepay\.tinkoff\.ru\/payment\/payses_terminal/);
      await expect.poll(() => paymentObservations(request)).toMatchObject({
        paymentSessionInitializations: 0,
        paymentSessions: [{ id: "payses_terminal", status }],
      });
    });
  }

  for (const scenario of ["missing", "malformed", "insecure", "unapproved", "credentials"] as const) {
    test(`fails closed for a reused ${scenario} payment URL`, async ({ page, request }) => {
      // Given: an active T-Bank session has unusable persisted payment data.
      await configureScenario(request, scenario);
      await seedCart(page, RETRY_CART_ID, [SAMPLE_CART_ITEM]);
      await configureSession(request, "pending_authorization");
      await page.goto(`${APP_URL}/checkout`);
      await fillCheckout(page);

      // When: checkout is replayed.
      await page.getByRole("button", { name: "Подтвердить заказ" }).click();

      // Then: no replacement bank session is created.
      await expect(page).toHaveURL(`${APP_URL}/checkout`);
      await expect(page.locator("p[role='alert']")).toBeVisible();
      await expect.poll(() => paymentObservations(request)).toMatchObject({
        paymentSessionInitializations: 0,
      });
    });
  }

  test("a foreign-provider session is not reused as T-Bank authority", async ({ page, request }) => {
    // Given: the collection only has a different provider's session.
    await configureScenario(request, "wrong_provider");
    await seedCart(page, RETRY_CART_ID, [SAMPLE_CART_ITEM]);
    await configureSession(request, "pending_authorization");
    await page.goto(`${APP_URL}/checkout`);
    await fillCheckout(page);

    // When: checkout selects the configured provider.
    await page.getByRole("button", { name: "Подтвердить заказ" }).click();

    // Then: the foreign session is not redirected to, and T-Bank initialization is attempted once.
    await expect(page).toHaveURL(`${APP_URL}/checkout`);
    await expect(page.locator("p[role='alert']")).toBeVisible();
    await expect.poll(() => paymentObservations(request)).toMatchObject({
      paymentSessionInitializations: 1,
    });
  });

  for (const status of ["error", "canceled"] as const) {
    test(`replaces a terminal ${status} session once before retrying checkout`, async ({ page, request }) => {
      // Given: T-Bank definitively ended the previous payment session.
      await page.route(APPROVED_BANK_ROUTE, (route) => route.fulfill({ status: 200, body: "Bank form" }));
      await seedCart(page, RETRY_CART_ID, [SAMPLE_CART_ITEM]);
      await configureSession(request, status);
      await page.goto(`${APP_URL}/checkout`);
      await fillCheckout(page);

      // When: the shopper retries checkout.
      await page.getByRole("button", { name: "Подтвердить заказ" }).click();

      // Then: exactly one replacement session exists.
      await expect(page).toHaveURL(/https:\/\/securepay\.tinkoff\.ru\/payment\/payses_fixture_1/);
      await expect.poll(() => paymentObservations(request)).toMatchObject({
        paymentSessionInitializations: 1,
        paymentSessions: [{ id: "payses_fixture_1", status: "pending_authorization" }],
      });
    });
  }

  for (const status of ["captured", "future_state"] as const) {
    test(`fails closed for a non-replaceable ${status} session`, async ({ page, request }) => {
      // Given: the collection has a same-provider session outside the active retry states.
      await seedCart(page, RETRY_CART_ID, [SAMPLE_CART_ITEM]);
      await configureSession(request, status);
      await page.goto(`${APP_URL}/checkout`);
      await fillCheckout(page);

      // When: checkout is replayed.
      await page.getByRole("button", { name: "Подтвердить заказ" }).click();

      // Then: it does not replace a possibly settled or unknown payment.
      await expect(page).toHaveURL(`${APP_URL}/checkout`);
      await expect(page.locator("p[role='alert']")).toBeVisible();
      await expect.poll(() => paymentObservations(request)).toMatchObject({
        paymentSessionInitializations: 0,
      });
    });
  }
});
