import {
  MARIO_MIKKE_COLLECTIONS,
  MARIO_MIKKE_PRODUCTS,
} from "../data/mario-mikke-catalog";

// Pure unit test: exercises only the static demo-catalog data, with no database,
// Medusa app boot or network. Its first job is simply to give `test:unit` at
// least one real test so the harness stops reporting "0 tests". It doubles as a
// guard for the invariants the catalog import (import-mario-mikke.ts) relies on —
// most importantly the uniqueness of the product handle, which is the upsert key
// the IMPORT-001 rework (ADR-001) uses to keep product IDs stable across re-imports.
describe("Mario Mikke demo catalog (data invariants)", () => {
  it("defines exactly 12 demo products", () => {
    expect(MARIO_MIKKE_PRODUCTS).toHaveLength(12);
  });

  it("has unique product ids and unique derived product handles", () => {
    const ids = MARIO_MIKKE_PRODUCTS.map((product) => product.id);
    expect(new Set(ids).size).toBe(ids.length);

    // import-mario-mikke.ts derives the product handle as `mario-mikke-<id>`.
    // Duplicate handles would make the upsert import ambiguous.
    const handles = MARIO_MIKKE_PRODUCTS.map(
      (product) => `mario-mikke-${product.id}`
    );
    expect(new Set(handles).size).toBe(handles.length);
  });

  it("has well-formed pricing, sizes, colours and category slugs", () => {
    for (const product of MARIO_MIKKE_PRODUCTS) {
      expect(product.name.trim().length).toBeGreaterThan(0);
      expect(Number.isInteger(product.price)).toBe(true);
      expect(product.price).toBeGreaterThan(0);
      expect(product.categorySlug.trim().length).toBeGreaterThan(0);
      expect(Array.isArray(product.availableSizes)).toBe(true);
      expect(product.colors.length).toBeGreaterThan(0);
      for (const color of product.colors) {
        expect(color.name.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it("only references existing products from collections", () => {
    const productIds = new Set(MARIO_MIKKE_PRODUCTS.map((product) => product.id));
    for (const collection of MARIO_MIKKE_COLLECTIONS) {
      expect(collection.handle.trim().length).toBeGreaterThan(0);
      expect(collection.productIds.length).toBeGreaterThan(0);
      for (const productId of collection.productIds) {
        expect(productIds.has(productId)).toBe(true);
      }
    }
  });
});
