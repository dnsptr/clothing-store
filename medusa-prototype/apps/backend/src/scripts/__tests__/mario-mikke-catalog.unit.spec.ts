import {
  MARIO_MIKKE_COLLECTIONS,
  MARIO_MIKKE_PRODUCTS,
  resolveVariantPackaging,
} from "../data/mario-mikke-catalog";
import { packagingFieldsToUpdate } from "../import-mario-mikke";

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

describe("Measured packaging for delivery", () => {
  it("does not price any unmeasured demo product using a made-up category box", () => {
    for (const product of MARIO_MIKKE_PRODUCTS) {
      expect(product.packaging).toBeUndefined();
      expect(resolveVariantPackaging(product)).toEqual({
        weight: null, length: null, width: null, height: null,
      });
    }
  });

  it("maps grams and centimetres onto the Medusa variant fields", () => {
    // Именно этот объект импорт подмешивает в каждый вариант — и при создании,
    // и при обновлении. Числа нарочно все разные: перепутанные местами длина и
    // ширина разъехались бы по всему каталогу молча.
    expect(
      resolveVariantPackaging({
        packaging: {
          weightGrams: 700,
          lengthCm: 36,
          widthCm: 26,
          heightCm: 9,
        },
      }),
    ).toEqual({ weight: 700, length: 36, width: 26, height: 9 });
  });
});

// Повторный импорт должен сохранять подтверждённые размеры и удалять оценки,
// внесённые до получения фактических замеров.
describe("packagingFieldsToUpdate (обновление упаковки существующего варианта)", () => {
  const desiredPackaging = { weight: 500, length: 35, width: 25, height: 8 };

  it("не шлёт ничего, когда в базе уже те же цифры", () => {
    expect(packagingFieldsToUpdate({ ...desiredPackaging }, desiredPackaging)).toEqual(
      {},
    );
  });

  it("не шлёт ничего, когда база отдала числа строками", () => {
    // Колонки были `numeric` до миграции Medusa 20260301002050, и на таких
    // базах драйвер отдаёт "500" вместо 500. Строгое сравнение объявляло бы
    // расхождение на каждом прогоне и переписывало те же значения.
    expect(
      packagingFieldsToUpdate(
        { weight: "500", length: "35", width: "25", height: "8" },
        desiredPackaging,
      ),
    ).toEqual({});
  });

  it("заполняет пустую упаковку варианта, созданного до этой правки", () => {
    expect(
      packagingFieldsToUpdate(
        { weight: null, length: null, width: null, height: null },
        desiredPackaging,
      ),
    ).toEqual(desiredPackaging);
  });

  it("возвращает упаковку целиком, даже если разошлось одно измерение", () => {
    // Частичный патч оставил бы вариант с несогласованными сторонами коробки —
    // тариф считается по всем четырём числам сразу.
    expect(
      packagingFieldsToUpdate(
        { ...desiredPackaging, height: 12 },
        desiredPackaging,
      ),
    ).toEqual(desiredPackaging);
  });

  it("updates the product dimensions when measured values differ", () => {
    expect(
      packagingFieldsToUpdate(
        { weight: 20, length: 10, width: 10, height: 10 },
        desiredPackaging,
      ),
    ).toEqual(desiredPackaging);
  });

  it("clears previously imported estimate dimensions instead of retaining a false quote", () => {
    const unmeasured = { weight: null, length: null, width: null, height: null };
    expect(packagingFieldsToUpdate(
      { weight: 500, length: 35, width: 25, height: 8 }, unmeasured,
    )).toEqual(unmeasured);
    expect(packagingFieldsToUpdate(unmeasured, unmeasured)).toEqual({});
  });
});

