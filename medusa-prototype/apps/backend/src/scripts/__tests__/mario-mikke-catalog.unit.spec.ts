import {
  FALLBACK_PACKAGING,
  MARIO_MIKKE_COLLECTIONS,
  MARIO_MIKKE_PRODUCTS,
  PACKAGING_BY_CATEGORY,
  resolveProductPackaging,
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

// Вес и габариты упаковки уезжают в варианты Medusa, а оттуда — в расчёт тарифа
// доставки. Ошибка здесь не падает: она молча превращается в неверную цену
// доставки, разницу по которой перевозчик выставит магазину после обмера.
// Поэтому справочник закрыт тестами: покрытие всех категорий каталога,
// вменяемость самих цифр и приоритет «переопределение товара > категория».
describe("Mario Mikke packaging reference (вес и габариты для доставки)", () => {
  it("covers every category slug used by the catalog", () => {
    // Пробел в справочнике не уронил бы импорт — резолвер молча подставил бы
    // огибающую. Ловим это здесь, а не по счёту от перевозчика.
    const uncovered = Array.from(
      new Set(MARIO_MIKKE_PRODUCTS.map((product) => product.categorySlug)),
    ).filter((categorySlug) => !PACKAGING_BY_CATEGORY[categorySlug]);

    expect(uncovered).toEqual([]);
  });

  it("keeps every packaging entry a plausible parcel", () => {
    for (const [categorySlug, packaging] of [
      ...Object.entries(PACKAGING_BY_CATEGORY),
      ["__fallback__", FALLBACK_PACKAGING] as const,
    ]) {
      // Граммы, а не килограммы: 50 г не бывает даже у пустого пакета, 20 кг —
      // уже не одежда, а признак перепутанной единицы измерения.
      expect(packaging.weightGrams).toBeGreaterThanOrEqual(100);
      expect(packaging.weightGrams).toBeLessThanOrEqual(20000);
      // Сантиметры, а не миллиметры: коробка меньше 5 см или больше метра по
      // стороне означала бы ту же ошибку в единицах.
      for (const measureCm of [
        packaging.lengthCm,
        packaging.widthCm,
        packaging.heightCm,
      ]) {
        expect(measureCm).toBeGreaterThanOrEqual(5);
        expect(measureCm).toBeLessThanOrEqual(100);
      }
      expect(
        Object.values(packaging).every((measure) => Number.isFinite(measure)),
      ).toBe(true);
      expect(categorySlug.trim().length).toBeGreaterThan(0);
    }
  });

  it("never understates the fallback against a known category", () => {
    // Огибающая существует ради неизвестной категории: занижение оплачивает
    // магазин, поэтому она не должна быть легче или мельче любой известной.
    for (const packaging of Object.values(PACKAGING_BY_CATEGORY)) {
      expect(FALLBACK_PACKAGING.weightGrams).toBeGreaterThanOrEqual(
        packaging.weightGrams,
      );
      expect(FALLBACK_PACKAGING.lengthCm).toBeGreaterThanOrEqual(
        packaging.lengthCm,
      );
      expect(FALLBACK_PACKAGING.widthCm).toBeGreaterThanOrEqual(
        packaging.widthCm,
      );
      expect(FALLBACK_PACKAGING.heightCm).toBeGreaterThanOrEqual(
        packaging.heightCm,
      );
    }
  });

  it("resolves packaging from the category reference", () => {
    expect(resolveProductPackaging({ categorySlug: "outerwear" })).toEqual(
      PACKAGING_BY_CATEGORY.outerwear,
    );
  });

  it("prefers a product-level override over the category default", () => {
    const override = {
      weightGrams: 2400,
      lengthCm: 45,
      widthCm: 35,
      heightCm: 20,
    };

    expect(
      resolveProductPackaging({
        categorySlug: "knitwear",
        packaging: override,
      }),
    ).toEqual(override);
  });

  it("falls back to the envelope packaging for an unknown category", () => {
    expect(resolveProductPackaging({ categorySlug: "no-such-category" })).toEqual(
      FALLBACK_PACKAGING,
    );
  });

  it("resolves packaging for every catalog product", () => {
    for (const product of MARIO_MIKKE_PRODUCTS) {
      expect(resolveProductPackaging(product)).not.toBe(FALLBACK_PACKAGING);
    }
  });

  it("maps grams and centimetres onto the Medusa variant fields", () => {
    // Именно этот объект импорт подмешивает в каждый вариант — и при создании,
    // и при обновлении. Числа нарочно все разные: перепутанные местами длина и
    // ширина разъехались бы по всему каталогу молча.
    expect(
      resolveVariantPackaging({
        categorySlug: "knitwear",
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

// Ветка reconcile импорта: существующие варианты обновляются на месте, поэтому
// решение «слать упаковку или нет» стоит между идемпотентностью повторного
// импорта и товаром, который уедет в доставку с пустым весом.
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

  it("исправляет расхождение с базой: источник истины — справочник", () => {
    expect(
      packagingFieldsToUpdate(
        { weight: 20, length: 10, width: 10, height: 10 },
        desiredPackaging,
      ),
    ).toEqual(desiredPackaging);
  });
});
