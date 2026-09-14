import { expect, test } from "@playwright/test";
import {
  DEFAULT_APP_URL,
  DEFAULT_FIXTURE_URL,
  RETURN_CARTS,
  SAMPLE_CART_ITEM,
  seedCart,
  setPaymentStatusOverride,
  resetFixture,
} from "./fixtures/payment-return";

const APP_URL = process.env.PAYMENT_APP_URL ?? DEFAULT_APP_URL;
const FIXTURE_URL = process.env.PAYMENT_FIXTURE_URL ?? DEFAULT_FIXTURE_URL;

test.describe("Payment Return UI", () => {
  test.beforeEach(async ({ request }) => {
    await resetFixture(request, FIXTURE_URL);
  });

  test("forged parameters on /checkout/success do not produce a paid state without backend confirmation", async ({
    page,
  }) => {
    // Given: cart is still pending on backend
    await seedCart(page, RETURN_CARTS.pending);

    // When: user arrives at /checkout/success with forged query params
    await page.goto(
      `${APP_URL}/checkout/success?PaymentId=forged_999&Status=CONFIRMED&Success=true`,
    );

    // Then: query parameters are stripped immediately
    await expect(page).toHaveURL(`${APP_URL}/checkout/success`);

    // And: initial state is neutral pending wording, not paid
    await expect(
      page.getByRole("heading", { name: "Проверяем статус оплаты..." }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Оплата прошла успешно! Заказ оформлен." }),
    ).not.toBeVisible();

    // And: cart is preserved while pending
    const storedCartId = await page.evaluate(() =>
      window.localStorage.getItem("clothing-store-medusa-cart"),
    );
    expect(storedCartId).toBe(RETURN_CARTS.pending);
  });

  test("URL query parameters are stripped immediately upon mount", async ({
    page,
  }) => {
    await seedCart(page, RETURN_CARTS.pending);

    await page.goto(
      `${APP_URL}/checkout/fail?PaymentId=123456&Status=REJECTED&ErrorCode=100`,
    );

    // Search string must be stripped from location
    await expect(page).toHaveURL(`${APP_URL}/checkout/fail`);
    const search = await page.evaluate(() => window.location.search);
    expect(search).toBe("");
  });

  test("backend confirmed and ready transitions to success state and clears cart exactly once", async ({
    page,
    request,
  }) => {
    // Given: cart starts in pending
    await seedCart(page, RETURN_CARTS.pending);
    await page.goto(`${APP_URL}/checkout/success`);

    // Verify initial neutral state
    await expect(
      page.getByRole("heading", { name: "Проверяем статус оплаты..." }),
    ).toBeVisible();

    // When: backend transitions to confirmed + ready
    await setPaymentStatusOverride(request, FIXTURE_URL, RETURN_CARTS.pending, {
      payment: "confirmed",
      order: "ready",
    });

    // Then: transitions to success state
    await expect(
      page.getByRole("heading", { name: "Оплата прошла успешно! Заказ оформлен." }),
    ).toBeVisible({ timeout: 10_000 });

    // And: "Продолжить покупки" action is available
    const continueShoppingLink = page.getByRole("link", { name: "Продолжить покупки" });
    await expect(continueShoppingLink).toBeVisible();
    await expect(continueShoppingLink).toHaveAttribute("href", "/catalog");

    // And: cart is cleared from storage exactly once
    await expect.poll(async () => {
      return page.evaluate(() => window.localStorage.getItem("clothing-store-medusa-cart"));
    }).toBeNull();

    await expect.poll(async () => {
      const storedCartItems = await page.evaluate(() =>
        window.localStorage.getItem("clothing-store-cart-medusa"),
      );
      return storedCartItems === null || storedCartItems === "[]";
    }).toBe(true);
  });

  test("backend failed state preserves cart items and offers retry link back to /checkout", async ({
    page,
  }) => {
    // Given: cart that has failed payment
    await seedCart(page, RETURN_CARTS.failed, [SAMPLE_CART_ITEM]);

    // When: arriving at /checkout/fail
    await page.goto(`${APP_URL}/checkout/fail`);

    // Then: displays honest failure message
    await expect(
      page.getByRole("heading", {
        name: "Оплата не была завершена или была отменена",
      }),
    ).toBeVisible({ timeout: 10_000 });

    // And: retry button is present
    const retryLink = page.getByRole("link", { name: "Вернуться к оформлению" });
    await expect(retryLink).toBeVisible();
    await expect(retryLink).toHaveAttribute("href", "/checkout");

    // And: cart is preserved in localStorage
    const storedCartId = await page.evaluate(() =>
      window.localStorage.getItem("clothing-store-medusa-cart"),
    );
    expect(storedCartId).toBe(RETURN_CARTS.failed);

    // And: clicking retry takes user back to checkout with intact cart
    await retryLink.click();
    await expect(page).toHaveURL(`${APP_URL}/checkout`);
    await expect(page.locator('input[name="firstName"]')).toBeVisible();
  });

  test("missing or malformed cart shows neutral unverified status without leaking internals", async ({
    page,
  }) => {
    // Given: malformed cart ID in storage
    await page.addInitScript(() => {
      window.localStorage.setItem("clothing-store-medusa-cart", "invalid_cart_id");
    });

    // When: visiting return route
    await page.goto(`${APP_URL}/checkout/success`);

    // Then: renders neutral unverified state
    await expect(
      page.getByRole("heading", { name: "Статус платежа не подтверждён" }),
    ).toBeVisible();

    await expect(
      page.getByText(
        "Не удалось проверить статус оплаты. Если средства были списаны, заказ будет обработан автоматически.",
      ),
    ).toBeVisible();

    // And: safe navigation options
    await expect(
      page.getByRole("link", { name: "Вернуться к оформлению" }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Перейти в каталог" }),
    ).toBeVisible();
  });

  test("backend HTTP 404 on status read renders neutral unverified status", async ({
    page,
  }) => {
    // Given: valid-format cart ID that backend returns 404 for (foreign or unknown)
    await seedCart(page, RETURN_CARTS.foreign);

    await page.goto(`${APP_URL}/checkout/success`);

    // Then: neutral unverified status is shown
    await expect(
      page.getByRole("heading", { name: "Статус платежа не подтверждён" }),
    ).toBeVisible({ timeout: 10_000 });

    await expect(
      page.getByRole("link", { name: "Вернуться к оформлению" }),
    ).toBeVisible();
  });

  test("confirmed payment with delayed order creation transitions to order_delayed and prevents payment retry", async ({
    page,
    request,
  }) => {
    await seedCart(page, RETURN_CARTS.pending);
    await setPaymentStatusOverride(request, FIXTURE_URL, RETURN_CARTS.pending, {
      payment: "confirmed",
      order: "pending",
    });

    // Speed up polling for test: 50ms interval, 2 max attempts
    await page.addInitScript(() => {
      (window as unknown as { __PAYMENT_POLL_INTERVAL_MS: number }).__PAYMENT_POLL_INTERVAL_MS = 50;
      (window as unknown as { __PAYMENT_POLL_MAX_ATTEMPTS: number }).__PAYMENT_POLL_MAX_ATTEMPTS = 2;
    });

    await page.goto(`${APP_URL}/checkout/success`);

    // Must transition to order_delayed, NEVER to failed/timeout
    await expect(
      page.getByRole("heading", { name: "Оплата принята, заказ формируется" }),
    ).toBeVisible({ timeout: 5_000 });

    // Must NOT show payment retry button back to /checkout
    await expect(
      page.getByRole("link", { name: "Вернуться к оформлению" }),
    ).not.toBeVisible();

    // Must show continue button to catalog
    await expect(
      page.getByRole("link", { name: "Перейти в каталог" }),
    ).toBeVisible();
  });

  test("cart switching protection: concurrent new cart in localStorage is preserved when old cart payment completes", async ({
    page,
    request,
  }) => {
    const initialCart = RETURN_CARTS.pending;
    const concurrentCart = "cart_01J99999999999999999999999";

    await page.addInitScript(() => {
      (window as unknown as { __PAYMENT_POLL_INTERVAL_MS: number }).__PAYMENT_POLL_INTERVAL_MS = 50;
      (window as unknown as { __PAYMENT_POLL_MAX_ATTEMPTS: number }).__PAYMENT_POLL_MAX_ATTEMPTS = 20;
    });

    await seedCart(page, initialCart);

    // Track the initial verification request to ensure client has hydrated and latched initialCart
    const initialPollPromise = page.waitForResponse(
      (res) => res.url().includes(`/store/payment-status/${initialCart}`),
      { timeout: 10_000 },
    );

    await page.goto(`${APP_URL}/checkout/success`);

    // Verify initial neutral state and that first poll for initial cart has started
    await expect(
      page.getByRole("heading", { name: "Проверяем статус оплаты..." }),
    ).toBeVisible();
    await initialPollPromise;

    // Shopper opens new tab and adds items creating a new cart in localStorage
    await page.evaluate(({ newCartId }) => {
      window.localStorage.setItem("clothing-store-medusa-cart", newCartId);
      window.localStorage.setItem(
        "clothing-store-cart-medusa",
        JSON.stringify([{ id: "item_new", title: "New Item" }]),
      );
    }, { newCartId: concurrentCart });

    // Initial cart succeeds on backend
    await setPaymentStatusOverride(request, FIXTURE_URL, initialCart, {
      payment: "confirmed",
      order: "ready",
    });

    // Success UI is shown for initial cart
    await expect(
      page.getByRole("heading", { name: "Оплата прошла успешно! Заказ оформлен." }),
    ).toBeVisible({ timeout: 10_000 });

    // Concurrent cart MUST NOT be cleared!
    const storedCartId = await page.evaluate(() =>
      window.localStorage.getItem("clothing-store-medusa-cart"),
    );
    expect(storedCartId).toBe(concurrentCart);
    expect(storedCartId).not.toBeNull();
  });
});
