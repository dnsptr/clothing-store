import type { APIRequestContext, Page } from "@playwright/test";
import {
  DEFAULT_FIXTURE_URL,
  FIXTURE_RETURN_CARTS,
} from "./store-api-fixture";

export const DEFAULT_APP_URL = "http://127.0.0.1:4173";
export { DEFAULT_FIXTURE_URL };

export const RETURN_CARTS = {
  ...FIXTURE_RETURN_CARTS,
  unknown: "cart_01J00000000000000000000009",
} as const;

export const SAMPLE_CART_ITEM = {
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

export async function seedCart(
  page: Page,
  cartId: string,
  items: readonly object[] = [SAMPLE_CART_ITEM],
): Promise<void> {
  await page.addInitScript(
    ({ id, cartItems }) => {
      window.localStorage.setItem("clothing-store-medusa-cart", id);
      window.localStorage.setItem("clothing-store-cart-medusa", JSON.stringify(cartItems));
    },
    { id: cartId, cartItems: items },
  );
}

export async function setPaymentStatusOverride(
  request: APIRequestContext,
  fixtureUrl: string,
  cartId: string,
  status: { payment: "pending" | "confirmed" | "failed"; order: "pending" | "ready" } | "not_found" | null,
): Promise<void> {
  const response = await request.post(`${fixtureUrl}/__control/payment-status`, {
    data: { cartId, status },
  });
  if (!response.ok()) {
    throw new Error(`Failed to set payment status override: ${response.status()}`);
  }
}

export async function resetFixture(
  request: APIRequestContext,
  fixtureUrl: string,
): Promise<void> {
  const response = await request.post(`${fixtureUrl}/__control/reset`);
  if (!response.ok()) {
    throw new Error(`Failed to reset fixture: ${response.status()}`);
  }
}
