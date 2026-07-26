import type { Product, ProductVariant } from "./product";
import { isMedusaConfigured } from "./medusa";

/**
 * Demo size ladder. Valid ONLY for the mock catalog — it is not a fact about the
 * real assortment, which is ~90% ONE SIZE (ADR-001 §3). Never render it for a
 * Medusa-backed product; use `selectableSizes` instead.
 */
export const AVAILABLE_SIZES = ["XS", "S", "M", "L", "XL"];

export const DEFAULT_RECOMMENDATION_SIZE = "S";

/**
 * Sizes a secondary surface (cart/favourites/checkout recommendation strip) may
 * offer for a product.
 *
 * ADR-001 §3 guarantees every Medusa product carries a `Размер` option with at
 * least `ONE SIZE`, so an empty list in medusa mode means the product is
 * misconfigured. In that case we offer nothing rather than inventing XS–XL:
 * a fabricated size cannot resolve to a real variant, and CAT-003 forbids the UI
 * from presenting combinations that do not exist in Medusa. The demo ladder
 * survives only for mock mode, where it is the intended stand-in.
 */
export function selectableSizes(product: Pick<Product, "availableSizes">): string[] {
  if (product.availableSizes.length > 0) return product.availableSizes;
  return isMedusaConfigured ? [] : AVAILABLE_SIZES;
}

export const DELIVERY = {
  cartFreeThreshold: 15000,
  cartPrice: 700,
  checkoutPrice: 350,
} as const;

/**
 * Resolve the variant a secondary surface is about to add to the cart.
 *
 * These surfaces used to build the payload with
 * `product.variants.find(...)?.variantId ?? ""`, so an unmatched selection sent
 * an empty variant id to Medusa instead of being prevented. Returning
 * `undefined` here lets the caller disable its button, which is what CAT-003
 * asks for: the UI must not offer a combination that does not exist.
 *
 * Axes are matched only where the product has them, so a ONE SIZE item with no
 * colour option still resolves.
 */
export function findAddableVariant(
  product: Pick<Product, "variants">,
  selection: { size?: string; colorName?: string },
): ProductVariant | undefined {
  return product.variants.find(
    (variant) =>
      variant.available &&
      (!selection.size || variant.options.Размер === selection.size) &&
      (!selection.colorName || variant.options.Цвет === selection.colorName),
  );
}
