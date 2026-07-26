/**
 * Вес и габариты отправления в упакованном виде.
 *
 * Единицы вынесены в имена полей намеренно: Medusa хранит weight/length/width/
 * height как безразмерные числа и ничего не проверяет, поэтому перепутанные
 * граммы с килограммами не поймает ни база, ни компилятор — только цена
 * доставки, и уже на боевом заказе.
 */
export type PackagingDimensions = {
  /** Вес брутто в ГРАММАХ (вещь + пакет/коробка). */
  weightGrams: number;
  /** Длина упаковки в САНТИМЕТРАХ. */
  lengthCm: number;
  /** Ширина упаковки в САНТИМЕТРАХ. */
  widthCm: number;
  /** Высота упаковки в САНТИМЕТРАХ. */
  heightCm: number;
};

export type DemoCatalogProduct = {
  id: string;
  name: string;
  price: number;
  category: string;
  categorySlug: string;
  materialSlugs: string[];
  availableSizes: string[];
  images: string[];
  colors: { name: string; hex: string }[];
  isNew?: boolean;
  isSoldOut?: boolean;
  /**
   * Переопределение упаковки для конкретного товара: категория задаёт типовую
   * коробку, но отдельные вещи из неё выбиваются (кожаный шопер, пальто-
   * оверсайз). Заполнять только при реальном основании — иначе цифра тихо
   * разойдётся со справочником и её забудут пересмотреть, когда придут данные
   * заказчика.
   */
  packaging?: PackagingDimensions;
};

export type DemoCatalogCollection = {
  handle: string;
  title: string;
  productIds: string[];
};

// =============================================================================
// ВЕС И ГАБАРИТЫ УПАКОВКИ — ВРЕМЕННЫЕ ИНЖЕНЕРНЫЕ ОЦЕНКИ, А НЕ ДАННЫЕ ЗАКАЗЧИКА
//
// Агрегатор доставки (ApiShip) считает тариф по весу и габаритам отправления,
// и берёт их с варианта Medusa (weight/length/width/height). Пока варианты
// создавались без этих полей, расчёт уходил бы на дефолты плагина
// (10×10×10 см, 20 г) — это не «приблизительно», а заведомо неверный тариф:
// пальто уехало бы по цене конверта, а разницу перевозчик выставил бы магазину
// после фактического обмера.
//
// Цифры ниже поставлены, чтобы расчёт доставки можно было собрать и прогнать
// до ответа заказчика. Реальные значения даст он: запрос «типовые вес и
// габариты упаковки» уже отправлен (docs/customer-requests.md, §3.2) и без него
// задача по доставке не закрывается. Когда ответ придёт — правим справочник
// здесь, повторный импорт каталога сам разнесёт новые значения по вариантам
// (import-mario-mikke.ts обновляет варианты на месте).
//
// Контракт значений:
//   * вес — в ГРАММАХ, габариты — в САНТИМЕТРАХ;
//   * всё — для УПАКОВАННОГО вида (вещь + пакет или коробка), не для вещи;
//   * ключ справочника — categorySlug товара.
// =============================================================================
export const PACKAGING_BY_CATEGORY: Record<string, PackagingDimensions> = {
  // Пальто и тренчи: плотная шерсть, самая тяжёлая и объёмная позиция каталога.
  outerwear: { weightGrams: 1500, lengthCm: 40, widthCm: 30, heightCm: 12 },
  // Трикотаж (джемперы, платья-кафтаны): сжимается в курьерский пакет.
  knitwear: { weightGrams: 500, lengthCm: 35, widthCm: 25, heightCm: 8 },
  // Брюки и юбки: чуть плотнее трикотажа, тот же формат пакета.
  trousers: { weightGrams: 600, lengthCm: 35, widthCm: 25, heightCm: 8 },
  // Аксессуары: ориентир — кожаный шопер; он не сминается, отсюда высота.
  accessories: { weightGrams: 900, lengthCm: 40, widthCm: 30, heightCm: 15 },
  // Обувь: вес и габариты вместе с обувной коробкой (в каталоге — сапоги).
  shoes: { weightGrams: 1600, lengthCm: 37, widthCm: 25, heightCm: 15 },
};

/**
 * Запасной вариант для категории, которой нет в справочнике: верхняя огибающая
 * по каждому измерению. Ошибаться приходится в какую-то сторону, и занижение
 * дороже: недовешенное отправление магазин доплачивает перевозчику по факту
 * обмера, тогда как завышенное — просто дороже посчитанная доставка, которую
 * видно сразу. Пробелов в справочнике при этом быть не должно — их ловит
 * юнит-тест на покрытие всех categorySlug каталога.
 */
export const FALLBACK_PACKAGING: PackagingDimensions = {
  weightGrams: 1600,
  lengthCm: 40,
  widthCm: 30,
  heightCm: 15,
};

/** Приоритет: переопределение товара → справочник категории → огибающая. */
export function resolveProductPackaging(
  product: Pick<DemoCatalogProduct, "categorySlug" | "packaging">,
): PackagingDimensions {
  return (
    product.packaging ??
    PACKAGING_BY_CATEGORY[product.categorySlug] ??
    FALLBACK_PACKAGING
  );
}

/** Поля варианта Medusa, в которые ложится упаковка. */
export type VariantPackagingFields = {
  weight: number;
  length: number;
  width: number;
  height: number;
};

/**
 * Единственное место, где именованные граммы и сантиметры превращаются в
 * безразмерные числа Medusa. Держим перевод одной функцией, чтобы обе ветки
 * импорта (создание и обновление вариантов) не разъехались в единицах.
 */
export function resolveVariantPackaging(
  product: Pick<DemoCatalogProduct, "categorySlug" | "packaging">,
): VariantPackagingFields {
  const packaging = resolveProductPackaging(product);

  return {
    weight: packaging.weightGrams,
    length: packaging.lengthCm,
    width: packaging.widthCm,
    height: packaging.heightCm,
  };
}

export const MARIO_MIKKE_PRODUCTS: DemoCatalogProduct[] = [
  {
    id: "1",
    name: "Комплект с брюками палаццо и свободным топом",
    price: 19800,
    category: "Пальто и тренчи",
    categorySlug: "outerwear",
    materialSlugs: ["linen"],
    availableSizes: ["XS", "S", "M", "L"],
    images: [
      "/products/1/1-1.jpg",
      "/products/1/1-2.jpg",
      "/products/1/1-3.jpg",
    ],
    colors: [
      { name: "Песочный", hex: "#E1DBD3" },
      { name: "Угольный", hex: "#1C1B1A" },
    ],
    isNew: true,
  },
  {
    id: "2",
    name: "Джемпер с геометрическим узором",
    price: 14500,
    category: "Трикотаж",
    categorySlug: "knitwear",
    materialSlugs: ["cashmere"],
    availableSizes: ["S", "M", "L"],
    images: [
      "/products/2/2-1.png",
      "/products/2/2-2.png",
      "/products/2/2-3.png",
    ],
    colors: [
      { name: "Молочный", hex: "#F3EFE9" },
      { name: "Тауп", hex: "#8E8276" },
    ],
    isNew: true,
  },
  {
    id: "3",
    name: "Юбка макси с принтом пейсли",
    price: 9800,
    category: "Брюки",
    categorySlug: "trousers",
    materialSlugs: ["linen"],
    availableSizes: ["XS", "S", "M"],
    images: [
      "/products/3/3-1.png",
      "/products/3/3-2.png",
      "/products/3/3-3.png",
    ],
    colors: [
      { name: "Светло-бежевый", hex: "#EDEAE4" },
      { name: "Горький шоколад", hex: "#302E2B" },
    ],
  },
  {
    id: "4",
    name: "Сумка-шопер из фактурной кожи",
    price: 22000,
    category: "Аксессуары",
    categorySlug: "accessories",
    materialSlugs: ["leather"],
    availableSizes: [],
    images: [
      "/products/4/4-1.png",
      "/products/4/4-2.png",
      "/products/4/4-3.png",
    ],
    colors: [
      { name: "Шоколад", hex: "#50352A" },
      { name: "Черный", hex: "#1C1B1A" },
    ],
  },
  {
    id: "5",
    name: "Джемпер с коротким рукавом и нагрудным карманом",
    price: 18900,
    category: "Пальто и тренчи",
    categorySlug: "outerwear",
    materialSlugs: ["wool"],
    availableSizes: ["S", "M", "L", "XL"],
    images: [
      "/products/5/5-1.png",
      "/products/5/5-2.png",
      "/products/5/5-3.png",
    ],
    colors: [
      { name: "Песочный", hex: "#E1DBD3" },
      { name: "Шоколад", hex: "#50352A" },
    ],
    isNew: true,
  },
  {
    id: "6",
    name: "Джемпер свободного кроя с коротким рукавом",
    price: 12500,
    category: "Трикотаж",
    categorySlug: "knitwear",
    materialSlugs: ["silk"],
    availableSizes: ["XS", "S", "M"],
    images: [
      "/products/6/6-1.png",
      "/products/6/6-2.png",
      "/products/6/6-3.png",
    ],
    colors: [
      { name: "Молочный", hex: "#F3EFE9" },
      { name: "Черный", hex: "#1C1B1A" },
    ],
  },
  {
    id: "7",
    name: "Юбка миди в клетку",
    price: 11800,
    category: "Брюки",
    categorySlug: "trousers",
    materialSlugs: ["wool"],
    availableSizes: ["S", "M", "L"],
    images: [
      "/products/7/7-1.png",
      "/products/7/7-2.png",
      "/products/7/7-3.png",
    ],
    colors: [
      { name: "Угольный", hex: "#1C1B1A" },
      { name: "Тауп", hex: "#8E8276" },
    ],
  },
  {
    id: "8",
    name: "Комплект с контрастной вышивкой",
    price: 15900,
    category: "Трикотаж",
    categorySlug: "knitwear",
    materialSlugs: ["cotton"],
    availableSizes: ["XS", "S", "M", "L"],
    images: [
      "/products/8/8-1.png",
      "/products/8/8-2.png",
      "/products/8/8-3.png",
    ],
    colors: [
      { name: "Овсяный", hex: "#E2DCD5" },
      { name: "Горький шоколад", hex: "#302E2B" },
    ],
    isNew: true,
  },
  {
    id: "9",
    name: "Платье-кафтан с декоративной вышивкой",
    price: 16500,
    category: "Трикотаж",
    categorySlug: "knitwear",
    materialSlugs: ["leather"],
    availableSizes: [],
    images: [
      "/products/9/9-1.png",
      "/products/9/9-2.png",
      "/products/9/9-3.png",
    ],
    colors: [
      { name: "Черный", hex: "#1C1B1A" },
      { name: "Молочный", hex: "#F3EFE9" },
    ],
  },
  {
    id: "10",
    name: "Платье-кафтан с контрастной отделкой",
    price: 6800,
    category: "Трикотаж",
    categorySlug: "knitwear",
    materialSlugs: ["wool", "cashmere"],
    availableSizes: [],
    images: [
      "/products/10/10-1.png",
      "/products/10/10-2.png",
      "/products/10/10-3.png",
    ],
    colors: [
      { name: "Светло-серый", hex: "#DCDCDC" },
      { name: "Песочный", hex: "#E1DBD3" },
    ],
  },
  {
    id: "11",
    name: "Сапоги из фактурной кожи",
    price: 13800,
    category: "Обувь",
    categorySlug: "shoes",
    materialSlugs: ["leather"],
    availableSizes: [],
    images: [
      "/products/11/11-1.png",
      "/products/11/11-2.png",
      "/products/11/11-3.png",
    ],
    colors: [
      { name: "Черный", hex: "#1C1B1A" },
      { name: "Карамель", hex: "#C68E5F" },
    ],
  },
  {
    id: "12",
    name: "Трикотажный костюм с цветочной вышивкой",
    price: 4900,
    category: "Трикотаж",
    categorySlug: "knitwear",
    materialSlugs: ["wool"],
    availableSizes: [],
    images: [
      "/products/12/12-1.png",
      "/products/12/12-2.png",
      "/products/12/12-3.png",
    ],
    colors: [
      { name: "Горький шоколад", hex: "#302E2B" },
      { name: "Черный", hex: "#1C1B1A" },
    ],
  },
];

export const MARIO_MIKKE_COLLECTIONS: DemoCatalogCollection[] = [
  {
    handle: "linen-look",
    title: "Льняной силуэт",
    productIds: ["1", "3", "4"],
  },
  {
    handle: "cashmere-cozy",
    title: "Теплый трикотаж",
    productIds: ["2", "7", "9"],
  },
  {
    handle: "autumn-chic",
    title: "Осенний шик",
    productIds: ["5", "6", "11"],
  },
];
