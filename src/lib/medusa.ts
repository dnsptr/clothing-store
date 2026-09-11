import { unstable_rethrow } from "next/navigation";

import type { Product } from "../data/mockData";

type UnknownRecord = Record<string, unknown>;

/**
 * Raised when a Medusa request fails at the transport/protocol level:
 * a non-2xx HTTP status or a body that is not valid JSON. Carries the
 * endpoint, HTTP status and a short body snippet for fast diagnosis in the
 * console (and, later, in Sentry).
 */
export class MedusaRequestError extends Error {
  readonly endpoint: string;
  readonly status?: number;
  readonly bodySnippet?: string;

  constructor(endpoint: string, detail: string, status?: number, bodySnippet?: string) {
    super(
      `Medusa request to ${endpoint} failed: ${detail}` +
        (bodySnippet ? ` — ${bodySnippet}` : ""),
    );
    this.name = "MedusaRequestError";
    this.endpoint = endpoint;
    this.status = status;
    this.bodySnippet = bodySnippet;
  }
}

/**
 * Raised when a Medusa response is well-formed JSON but violates the shape the
 * storefront relies on. Names the endpoint and the exact field that failed so a
 * malformed payload surfaces a diagnostic error instead of silently becoming a
 * Product with undefined fields.
 */
export class MedusaContractError extends Error {
  readonly endpoint: string;
  readonly field: string;

  constructor(endpoint: string, field: string, detail: string) {
    super(`Medusa contract violation at ${endpoint}: field "${field}" ${detail}.`);
    this.name = "MedusaContractError";
    this.endpoint = endpoint;
    this.field = field;
  }
}

interface MedusaStoreProduct {
  id: string;
  title: string;
  handle: string;
  description?: string | null;
  metadata?: unknown;
  images?: { url?: string | null }[];
  categories?: { name?: string | null; handle?: string | null }[];
  options?: {
    id?: string | null;
    title?: string | null;
    values?: { value?: string | null }[];
  }[];
  variants?: {
    id?: string | null;
    sku?: string | null;
    manage_inventory?: boolean | null;
    allow_backorder?: boolean | null;
    inventory_quantity?: number | null;
    calculated_price?: {
      calculated_amount?: number | null;
    } | null;
    options?: {
      value?: string | null;
      option_id?: string | null;
    }[];
  }[];
}

interface MedusaProductsResponse {
  products?: MedusaStoreProduct[];
  count?: number;
}

interface MedusaCategoriesResponse {
  product_categories?: { id: string; name?: string | null; handle?: string | null }[];
}

/** Minimal category shape the storefront needs to map a URL slug to a server filter. */
export interface MedusaCategory {
  id: string;
  name: string;
  handle: string;
}

interface MedusaRegionsResponse {
  regions?: { id: string; currency_code?: string | null }[];
}

export interface MedusaCart {
  id: string;
  total?: number | null;
  subtotal?: number | null;
  tax_total?: number | null;
  discount_total?: number | null;
  shipping_total?: number | null;
  items?: MedusaCartLine[];
}

/**
 * Строка корзины Medusa.
 *
 * Помимо идентификаторов и сумм строка несёт достаточно данных о товаре
 * (`title`, `thumbnail`, `product_handle`, `variant_title`), чтобы отрисовать
 * позицию, даже если товара нет в загруженной странице каталога. Это и есть
 * условие того, что корзина никогда не теряет строку, за которую сервер
 * продолжает считать деньги.
 */
export interface MedusaCartLine {
  id: string;
  title?: string | null;
  thumbnail?: string | null;
  variant_id?: string | null;
  variant_sku?: string | null;
  variant_title?: string | null;
  product_id?: string | null;
  product_title?: string | null;
  product_handle?: string | null;
  quantity: number;
  unit_price?: number | null;
  total?: number | null;
}

interface MedusaCartResponse {
  cart: MedusaCart;
}

interface MedusaLineItemDeleteResponse {
  parent: MedusaCart;
}

export interface MedusaShippingOption {
  id: string;
  name: string;
  /** Стоимость доставки в рублях; отсутствует у опций с расчётом на стороне провайдера. */
  amount?: number | null;
  type?: { code?: string | null } | null;
}

interface MedusaShippingOptionsResponse {
  shipping_options?: MedusaShippingOption[];
}

interface MedusaPaymentSession {
  id: string;
  provider_id: string;
  status: string;
  data: Record<string, unknown>;
}

interface MedusaPaymentCollectionResponse {
  payment_collection: {
    id: string;
    payment_sessions?: MedusaPaymentSession[];
  };
}

type MedusaCompleteCartResponse =
  | { type: "order"; order: { id: string; display_id?: number | null } }
  | { type: "cart"; error: { message: string } };

// Server-first credential resolution.
//
// `NEXT_PUBLIC_*` values are inlined into the client bundle at build time, so
// changing one used to require a full rebuild — the failure mode behind the
// production catalog outage (roadmap 0.1). On the server the unprefixed
// variables win and are read when the server process starts, so a Vercel env
// change takes effect on redeploy of the *environment*, not of the bundle.
//
// In the browser the unprefixed reads compile to `undefined`, so the public
// values remain the only source there. That is unavoidable for cart calls the
// browser makes directly; moving those behind a route handler so the key never
// reaches the client is a separate follow-up, not part of this change.
const backendUrl = (
  process.env.MEDUSA_BACKEND_URL ?? process.env.NEXT_PUBLIC_MEDUSA_BACKEND_URL
)?.replace(/\/$/, "");
const publishableKey =
  process.env.MEDUSA_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY;
const configuredRegionId =
  process.env.MEDUSA_REGION_ID ?? process.env.NEXT_PUBLIC_MEDUSA_REGION_ID;

export const storefrontDataMode =
  (process.env.DATA_MODE ?? process.env.NEXT_PUBLIC_DATA_MODE) === "medusa"
    ? "medusa"
    : "mock";
export const isMedusaConfigured =
  storefrontDataMode === "medusa" && Boolean(backendUrl && publishableKey);

/**
 * Встроенный провайдер Medusa. Он всегда авторизует платёж, не обращаясь ни к
 * какому банку, — то есть завершает корзину и создаёт заказ, за который никто
 * не заплатил, и по которому не пробит чек. В production он допустим только как
 * значение по умолчанию, которое витрина обязана распознать и отвергнуть.
 */
export const SYSTEM_DEFAULT_PAYMENT_PROVIDER_ID = "pp_system_default";

// Идентификатор платёжного провайдера и производный от него флаг оформления
// заказа читаются ТОЛЬКО из NEXT_PUBLIC_-переменной — в отличие от каталога,
// который резолвится server-first.
//
// Причина в том, где выполняется код. Каталог читается на сервере, поэтому
// server-first резолюция даёт выигрыш: смена переменной применяется без
// пересборки бандла. Оформление же заказа целиком живёт в браузере
// (CartContext дёргает Store API напрямую), а страница `/checkout`
// пререндерится. Если серверное и клиентское значения разойдутся, пререндер
// покажет одну форму, а гидратация — другую. Единственный источник значения
// исключает этот класс расхождений.
export const medusaPaymentProviderId =
  process.env.NEXT_PUBLIC_MEDUSA_PAYMENT_PROVIDER_ID?.trim() || "";

// Аварийный выход для локальной разработки и e2e: позволяет пройти весь путь
// оформления на встроенном провайдере. Намеренно не действует в production —
// иначе одна забытая переменная возвращает ровно тот риск, ради которого
// написан весь этот блок.
const isTestCheckoutAllowed =
  process.env.NODE_ENV !== "production" &&
  process.env.NEXT_PUBLIC_ALLOW_TEST_CHECKOUT === "true";

/**
 * Можно ли показывать покупателю оформление заказа.
 *
 * Ложен, пока не подключён боевой платёжный провайдер (задача «Оплата и касса»
 * роадмапа). Пока он ложен, витрина не показывает форму заказа, а
 * `completeCheckout` отказывается работать: без провайдера заказ создаётся без
 * оплаты, резервирует остаток и не сопровождается фискальным чеком (54-ФЗ).
 */
export const isCheckoutEnabled =
  medusaPaymentProviderId !== "" &&
  (medusaPaymentProviderId !== SYSTEM_DEFAULT_PAYMENT_PROVIDER_ID || isTestCheckoutAllowed);

// --- Конфигурационные предохранители ----------------------------------------
// Оба срабатывают только на сервере. В браузере бросать на уровне модуля нельзя:
// импорт этого файла есть в каждом клиентском компоненте, и исключение оставит
// покупателя с белым экраном вместо контролируемого состояния ошибки, которое
// уже реализовано в CatalogContext и на карточке товара.
const isServer = typeof window === "undefined";

// ADR-001 §6: production не маскирует ошибку конфигурации демо-каталогом.
// Раньше отсутствие ключа просто делало `isMedusaConfigured` ложным, и витрина
// тихо переключалась на 12 demo-товаров с выдуманными ценами — под HTTP 200 и с
// canonical, то есть с попаданием в индекс. Теперь это останавливает сборку или
// старт сервера с внятным сообщением.
if (isServer && process.env.NODE_ENV === "production" && storefrontDataMode === "medusa" && !isMedusaConfigured) {
  throw new Error(
    "DATA_MODE=medusa, но MEDUSA_BACKEND_URL и/или MEDUSA_PUBLISHABLE_KEY не заданы. " +
      "Витрина не запускается, чтобы не показать покупателю demo-каталог вместо боевого.",
  );
}

// Режим данных должен быть один. Раньше серверное и клиентское значения
// считались независимо, и конфигурация вида `DATA_MODE=medusa` +
// `NEXT_PUBLIC_DATA_MODE=mock` давала расщеплённую витрину: карточка товара из
// Medusa, каталог из моков, чекаут с ошибкой «Checkout requires Medusa mode».
// Расхождение видно только на сервере — там его и ловим.
if (isServer && process.env.DATA_MODE && process.env.NEXT_PUBLIC_DATA_MODE) {
  const serverMode = process.env.DATA_MODE === "medusa" ? "medusa" : "mock";
  const clientMode = process.env.NEXT_PUBLIC_DATA_MODE === "medusa" ? "medusa" : "mock";
  if (serverMode !== clientMode) {
    throw new Error(
      `Режим данных задан противоречиво: DATA_MODE=${process.env.DATA_MODE}, ` +
        `NEXT_PUBLIC_DATA_MODE=${process.env.NEXT_PUBLIC_DATA_MODE}. ` +
        "Серверный рендеринг и браузер работали бы с разными источниками данных.",
    );
  }
}

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

// --- Runtime contract guards (FE-003) --------------------------------------
// Each guard narrows a value or throws a diagnostic MedusaContractError that
// names the endpoint and the offending field path.

function expectRecord(value: unknown, endpoint: string, field: string): UnknownRecord {
  if (!isRecord(value)) {
    throw new MedusaContractError(endpoint, field, "is not an object");
  }
  return value;
}

function expectArray(value: unknown, endpoint: string, field: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new MedusaContractError(endpoint, field, "is not an array");
  }
  return value;
}

function expectString(value: unknown, endpoint: string, field: string): string {
  if (typeof value !== "string") {
    throw new MedusaContractError(endpoint, field, "is not a string");
  }
  return value;
}

function expectNumber(value: unknown, endpoint: string, field: string): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    throw new MedusaContractError(endpoint, field, "is not a number");
  }
  return value;
}

function getStringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function getColors(value: unknown): Product["colors"] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((item) => {
    if (!isRecord(item) || typeof item.name !== "string" || typeof item.hex !== "string") {
      return [];
    }

    return [{ name: item.name, hex: item.hex }];
  });
}

function unique(values: string[]) {
  return [...new Set(values)];
}

function getVariantOptions(
  variant: NonNullable<MedusaStoreProduct["variants"]>[number],
  optionTitlesById: Map<string, string>,
) {
  return Object.fromEntries(
    (variant.options || []).flatMap((option) => {
      const title = option.option_id ? optionTitlesById.get(option.option_id) : undefined;
      const value = option.value;
      return typeof title === "string" && typeof value === "string" ? [[title, value]] : [];
    }),
  );
}

function isVariantAvailable(variant: NonNullable<MedusaStoreProduct["variants"]>[number]) {
  if (variant.manage_inventory === false || variant.allow_backorder === true) return true;
  return typeof variant.inventory_quantity === "number" && variant.inventory_quantity > 0;
}

function normalizeImageUrl(url: string) {
  try {
    const parsedUrl = new URL(url);
    return parsedUrl.pathname.startsWith("/products/") ? parsedUrl.pathname : url;
  } catch {
    return url;
  }
}

function mapMedusaProduct(product: MedusaStoreProduct): Product | null {
  const metadata = isRecord(product.metadata) ? product.metadata : {};
  const profile = isRecord(metadata.catalog_profile) ? metadata.catalog_profile : {};
  const fields: [string, string][] = [
    ["model", "Модель"], ["brand", "Бренд"], ["composition", "Состав изделия"],
    ["lining", "Подкладка"], ["country", "Страна изготовления"],
    ["manufacturer", "Изготовитель"], ["manufacturer_address", "Адрес изготовителя"],
    ["manufactured_at", "Дата изготовления"], ["care", "Уход"],
    ["conformity_document", "Документ о соответствии"],
  ];
  const characteristics = fields.flatMap(([key, label]) => {
    const value = key === "lining" && profile.no_lining === true ? "Без подкладки" : profile[key];
    return typeof value === "string" && value.trim() ? [{ label, value: value.trim() }] : [];
  });
  let registryUrl: string | undefined;
  if (typeof profile.registry_url === "string") {
    try { const url = new URL(profile.registry_url); if (url.protocol === "https:") registryUrl = url.href; } catch { /* Incomplete drafts have no registry link. */ }
  }
  const frontendId = frontendIdFromHandle(product.handle, product.id);
  const category = product.categories?.[0];
  const optionTitlesById = new Map(
    (product.options || []).flatMap((option) =>
      typeof option.title === "string" && typeof option.id === "string"
        ? [[option.id, option.title]]
        : [],
    ),
  );
  const variants = (product.variants || []).flatMap((variant) => {
    const price = variant.calculated_price?.calculated_amount;
    if (
      typeof variant.id !== "string" ||
      typeof price !== "number"
    ) {
      return [];
    }

    return [{
      variantId: variant.id,
      sku: variant.sku ?? null,
      options: getVariantOptions(variant, optionTitlesById),
      price,
      available: isVariantAvailable(variant),
    }];
  });
  const options = (product.options || []).flatMap((option) => {
    if (typeof option.title !== "string") return [];

    return [{
      title: option.title,
      values: unique(
        (option.values || []).flatMap((value) =>
          typeof value.value === "string" ? [value.value] : [],
        ),
      ),
    }];
  });
  const sizes = options.find((option) => option.title === "Размер")?.values ?? [];
  const images = (product.images || []).flatMap((image) =>
    typeof image.url === "string" ? [normalizeImageUrl(image.url)] : [],
  );
  const colors = getColors(metadata.colors);
  const price = variants[0]?.price;
  // `description` входит в набор полей товара, который Store API отдаёт по
  // умолчанию: все элементы PRODUCT_FIELDS начинаются с `*`/`+`, то есть
  // дополняют дефолтные поля, а не заменяют их. Пустой текст приравниваем к его
  // отсутствию — иначе карточка отрисует пустой блок описания.
  const description = product.description?.trim() || undefined;

  // FE-002 / ADR-001 §6: in medusa mode a product is built ONLY from Medusa
  // data — never from MOCK_PRODUCTS. A product without a priced variant is
  // misconfigured (import guarantees priced variants), so skip it with a
  // diagnostic warning instead of rendering a bogus 0 ₽ item. Other soft
  // fields fall back to neutral defaults (empty images/colors, generic
  // category), not to demo data.
  if (typeof price !== "number") {
    console.warn("[Medusa] Товар без валидной цены варианта пропущен.", {
      id: product.id,
      handle: product.handle,
    });
    return null;
  }

  const available = variants.some((variant) => variant.available);

  return {
    id: frontendId,
    productId: product.id,
    handle: product.handle,
    name: product.title,
    description,
    characteristics,
    registryUrl,
    labelImages: Array.isArray(profile.label_images) ? profile.label_images.flatMap((image) => {
      if (!isRecord(image) || typeof image.url !== "string") return [];
      if (!/^https?:\/\//.test(image.url) && !/^\/(?!\/)/.test(image.url)) return [];
      return [{ name: typeof image.name === "string" ? image.name : "Этикетка", url: normalizeImageUrl(image.url) }];
    }) : [],
    categorySlugs: product.categories?.map((item) => item.handle || "").filter(Boolean),
    price,
    category: category?.name || "Каталог",
    categorySlug: category?.handle || "catalog",
    materialSlugs: getStringArray(metadata.material_slugs),
    availableSizes: sizes,
    images,
    colors,
    options,
    variants,
    available,
    isNew: Boolean(metadata.is_new),
    isSoldOut: !available,
  };
}

/**
 * Соглашение скрипта импорта каталога: handle товара в Medusa —
 * `mario-mikke-<frontend id>`. Держится в одном месте, потому что по нему
 * товар резолвят и карточка, и страница образа, и строка корзины.
 */
export const PRODUCT_HANDLE_PREFIX = "mario-mikke-";

export const handleForFrontendId = (id: string) => `${PRODUCT_HANDLE_PREFIX}${id}`;

export function frontendIdFromHandle(handle: string | null | undefined, fallback: string) {
  if (typeof handle === "string" && handle.startsWith(PRODUCT_HANDLE_PREFIX)) {
    const id = handle.slice(PRODUCT_HANDLE_PREFIX.length);
    if (id) return id;
  }
  return fallback;
}

/**
 * Собрать `Product` из строки корзины Medusa.
 *
 * Нужен, когда товара нет в каталоге, загруженном в браузер: каталожный
 * контекст держит только первую страницу, а серверная корзина знает обо всех
 * позициях. Раньше такая строка просто отбрасывалась — при этом `total`
 * сервера продолжал её учитывать, то есть покупатель платил за товар, которого
 * не видел в корзине.
 *
 * Данных строки хватает на честную отрисовку: название, миниатюра, цена и
 * количество приходят с сервера. Полей, которых в строке нет (категория,
 * материалы, палитра), здесь нет и не выдумывается — позиция остаётся
 * минимальной, но настоящей.
 */
export function mapCartLineToProduct(line: MedusaCartLine): Product {
  const productId = line.product_id || line.id;
  const id = frontendIdFromHandle(line.product_handle, productId);
  const name = line.product_title?.trim() || line.title?.trim() || "Товар";
  const price = typeof line.unit_price === "number" ? line.unit_price : 0;
  const variantTitle = line.variant_title?.trim() || "";
  const thumbnail = line.thumbnail?.trim();

  return {
    id,
    productId,
    handle: line.product_handle || handleForFrontendId(id),
    name,
    price,
    category: "Каталог",
    categorySlug: "catalog",
    materialSlugs: [],
    availableSizes: variantTitle ? [variantTitle] : [],
    images: thumbnail ? [normalizeImageUrl(thumbnail)] : [],
    colors: [],
    options: [],
    variants: line.variant_id
      ? [{
          variantId: line.variant_id,
          sku: line.variant_sku ?? null,
          options: {},
          price,
          available: true,
        }]
      : [],
    available: true,
  };
}

// --- Response parsers (FE-003) ---------------------------------------------
// Validate the fields the storefront actually consumes. Optional fields that
// mapMedusaProduct / CartContext already read defensively are intentionally not
// re-validated here; the goal is to stop invalid data from silently becoming a
// Product or a Cart, not to mirror the entire Medusa schema.

function parseProductsResponse(data: unknown, endpoint: string): MedusaProductsResponse {
  const root = expectRecord(data, endpoint, "$");
  const products = expectArray(root.products, endpoint, "products");
  products.forEach((item, index) => {
    const product = expectRecord(item, endpoint, `products[${index}]`);
    expectString(product.id, endpoint, `products[${index}].id`);
    expectString(product.title, endpoint, `products[${index}].title`);
    expectString(product.handle, endpoint, `products[${index}].handle`);
  });
  // Pagination relies on the total count Medusa reports alongside the page.
  expectNumber(root.count, endpoint, "count");
  return data as MedusaProductsResponse;
}

function parseCategoriesResponse(data: unknown, endpoint: string): MedusaCategoriesResponse {
  const root = expectRecord(data, endpoint, "$");
  const categories = expectArray(root.product_categories, endpoint, "product_categories");
  categories.forEach((item, index) => {
    const category = expectRecord(item, endpoint, `product_categories[${index}]`);
    expectString(category.id, endpoint, `product_categories[${index}].id`);
  });
  return data as MedusaCategoriesResponse;
}

function parseRegionsResponse(data: unknown, endpoint: string): MedusaRegionsResponse {
  const root = expectRecord(data, endpoint, "$");
  const regions = expectArray(root.regions, endpoint, "regions");
  regions.forEach((item, index) => {
    const region = expectRecord(item, endpoint, `regions[${index}]`);
    expectString(region.id, endpoint, `regions[${index}].id`);
  });
  return data as MedusaRegionsResponse;
}

function parseCartResponse(data: unknown, endpoint: string): MedusaCartResponse {
  const root = expectRecord(data, endpoint, "$");
  const cart = expectRecord(root.cart, endpoint, "cart");
  expectString(cart.id, endpoint, "cart.id");
  return data as MedusaCartResponse;
}

function parseLineItemDeleteResponse(
  data: unknown,
  endpoint: string,
): MedusaLineItemDeleteResponse {
  const root = expectRecord(data, endpoint, "$");
  const parent = expectRecord(root.parent, endpoint, "parent");
  expectString(parent.id, endpoint, "parent.id");
  return data as MedusaLineItemDeleteResponse;
}

function parseShippingOptionsResponse(
  data: unknown,
  endpoint: string,
): MedusaShippingOptionsResponse {
  const root = expectRecord(data, endpoint, "$");
  const options = expectArray(root.shipping_options, endpoint, "shipping_options");
  options.forEach((item, index) => {
    const option = expectRecord(item, endpoint, `shipping_options[${index}]`);
    expectString(option.id, endpoint, `shipping_options[${index}].id`);
    expectString(option.name, endpoint, `shipping_options[${index}].name`);
    if (option.amount !== undefined && option.amount !== null) {
      expectNumber(option.amount, endpoint, `shipping_options[${index}].amount`);
    }
    if (option.type !== undefined && option.type !== null) {
      const type = expectRecord(option.type, endpoint, `shipping_options[${index}].type`);
      if (type.code !== undefined && type.code !== null) {
        expectString(type.code, endpoint, `shipping_options[${index}].type.code`);
      }
    }
  });
  return data as MedusaShippingOptionsResponse;
}

function parsePaymentCollectionResponse(
  data: unknown,
  endpoint: string,
): MedusaPaymentCollectionResponse {
  const root = expectRecord(data, endpoint, "$");
  const collection = expectRecord(root.payment_collection, endpoint, "payment_collection");
  expectString(collection.id, endpoint, "payment_collection.id");
  return data as MedusaPaymentCollectionResponse;
}

function parseInitializedPaymentCollectionResponse(
  data: unknown,
  endpoint: string,
): MedusaPaymentCollectionResponse {
  const parsed = parsePaymentCollectionResponse(data, endpoint);
  const collection = expectRecord(parsed.payment_collection, endpoint, "payment_collection");
  const sessions = expectArray(
    collection.payment_sessions,
    endpoint,
    "payment_collection.payment_sessions",
  );
  sessions.forEach((item, index) => {
    const session = expectRecord(
      item,
      endpoint,
      `payment_collection.payment_sessions[${index}]`,
    );
    expectString(session.id, endpoint, `payment_collection.payment_sessions[${index}].id`);
    expectString(
      session.provider_id,
      endpoint,
      `payment_collection.payment_sessions[${index}].provider_id`,
    );
    expectString(
      session.status,
      endpoint,
      `payment_collection.payment_sessions[${index}].status`,
    );
    expectRecord(session.data, endpoint, `payment_collection.payment_sessions[${index}].data`);
  });
  return parsed;
}

function parseCompleteCartResponse(
  data: unknown,
  endpoint: string,
): MedusaCompleteCartResponse {
  const root = expectRecord(data, endpoint, "$");
  if (root.type === "order") {
    const order = expectRecord(root.order, endpoint, "order");
    expectString(order.id, endpoint, "order.id");
    return data as MedusaCompleteCartResponse;
  }
  if (root.type === "cart") {
    const error = expectRecord(root.error, endpoint, "error");
    expectString(error.message, endpoint, "error.message");
    return data as MedusaCompleteCartResponse;
  }
  throw new MedusaContractError(endpoint, "type", 'is neither "order" nor "cart"');
}

async function readBodySnippet(response: Response): Promise<string | undefined> {
  try {
    const text = await response.text();
    return text ? text.slice(0, 300) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Admin-managed prices and content must be fresh on a regular page reload.
 * Zero disables persistent caching; request-level fetch memoization remains.
 */
export const CATALOG_REVALIDATE_SECONDS = 0;

/**
 * Exported so sibling modules (lib/content.ts) reuse one HTTP client rather
 * than growing a second one: the publishable-key header, the error taxonomy and
 * the Next 16 revalidate semantics above are easy to get subtly wrong twice.
 */
export async function medusaRequest<T>(
  path: string,
  options: {
    body?: unknown;
    method?: "DELETE" | "POST";
    signal?: AbortSignal;
    parse?: (data: unknown, endpoint: string) => T;
    revalidate?: number;
  } = {},
): Promise<T> {
  if (!backendUrl || !publishableKey) {
    throw new Error("Medusa storefront environment variables are not configured.");
  }

  const endpoint = path.split("?")[0];

  let response: Response;
  try {
    response = await fetch(`${backendUrl}${path}`, {
      method: options.method,
      headers: {
        "x-publishable-api-key": publishableKey,
        ...(options.body ? { "content-type": "application/json" } : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: options.signal,
      ...(typeof options.revalidate === "number" && options.revalidate > 0
        ? { next: { revalidate: options.revalidate } }
        : { cache: "no-store" as const }),
    });
  } catch (error) {
    unstable_rethrow(error);

    // Preserve cancellation semantics so callers can detect aborted requests.
    if (options.signal?.aborted || (error instanceof DOMException && error.name === "AbortError")) {
      throw error;
    }
    const detail = error instanceof Error ? error.message : String(error);
    throw new MedusaRequestError(endpoint, `network error: ${detail}`);
  }

  if (!response.ok) {
    throw new MedusaRequestError(
      endpoint,
      `HTTP ${response.status}`,
      response.status,
      await readBodySnippet(response),
    );
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new MedusaRequestError(endpoint, "response body is not valid JSON", response.status);
  }

  return options.parse ? options.parse(data, endpoint) : (data as T);
}

async function getRussianRegionId(signal?: AbortSignal, revalidate?: number) {
  if (configuredRegionId) return configuredRegionId;

  const response = await medusaRequest(
    "/store/regions?limit=100",
    { signal, parse: parseRegionsResponse, revalidate },
  );
  return response.regions?.find((region) => region.currency_code === "rub")?.id;
}

const PRODUCT_FIELDS =
  "*variants.calculated_price,*variants.options,+variants.inventory_quantity,*options,*options.values,*categories,*images,+metadata";

function mapProductsPage(products: MedusaStoreProduct[]): Product[] {
  return products
    .flatMap((product) => {
      const mapped = mapMedusaProduct(product);
      return mapped ? [mapped] : [];
    })
    // Keep a stable numeric order within the page (parity with the pre-pagination client).
    .sort((first, second) => Number(first.id) - Number(second.id));
}

export interface FetchMedusaProductsParams {
  limit: number;
  offset: number;
  categoryId?: string;
  collectionId?: string;
}

export interface MedusaProductsPage {
  products: Product[];
  count: number;
}

/**
 * Fetch a single page of catalog products. Returns the mapped products for the
 * page plus the total `count` Medusa reports (used to drive "load more" until the
 * catalog is exhausted). Sorting by Number(id) is applied within the page only.
 */
export async function fetchMedusaProducts(
  params: FetchMedusaProductsParams,
  signal?: AbortSignal,
): Promise<MedusaProductsPage> {
  const regionId = await getRussianRegionId(signal);
  const query = new URLSearchParams({
    limit: String(params.limit),
    offset: String(params.offset),
    fields: PRODUCT_FIELDS,
  });

  if (regionId) query.set("region_id", regionId);
  // Medusa v2 accepts repeated/array category filters via `category_id[]`.
  if (params.categoryId) query.set("category_id[]", params.categoryId);
  if (params.collectionId) query.set("collection_id[]", params.collectionId);

  const response = await medusaRequest(`/store/products?${query.toString()}`, {
    signal,
    parse: parseProductsResponse,
  });

  return {
    products: mapProductsPage(response.products || []),
    count: typeof response.count === "number" ? response.count : 0,
  };
}

/**
 * Fetch one product by its Medusa handle (e.g. `mario-mikke-12`). Used by the PDP
 * to resolve a product that is not present in the (paginated) global catalog
 * context. Returns null when no product matches or the match has no priced
 * variant. Reuses the same fields + parser + mapper as the list fetch.
 */
export async function fetchMedusaProductByHandle(
  handle: string,
  signal?: AbortSignal,
  revalidate?: number,
): Promise<Product | null> {
  const regionId = await getRussianRegionId(signal, revalidate);
  const query = new URLSearchParams({
    handle,
    limit: "1",
    fields: PRODUCT_FIELDS,
  });

  if (regionId) query.set("region_id", regionId);

  const response = await medusaRequest(`/store/products?${query.toString()}`, {
    signal,
    parse: parseProductsResponse,
    revalidate,
  });

  const [product] = response.products || [];
  return product ? mapMedusaProduct(product) : null;
}

/** Preserve imported URLs; admin-created products use their stable Medusa id. */
export async function fetchMedusaProductByFrontendId(
  id: string,
  signal?: AbortSignal,
  revalidate?: number,
): Promise<Product | null> {
  if (!id.startsWith("prod_")) {
    return fetchMedusaProductByHandle(handleForFrontendId(id), signal, revalidate);
  }

  const regionId = await getRussianRegionId(signal, revalidate);
  const query = new URLSearchParams({ "id[]": id, limit: "1", fields: PRODUCT_FIELDS });
  if (regionId) query.set("region_id", regionId);
  const response = await medusaRequest(`/store/products?${query.toString()}`, {
    signal,
    parse: parseProductsResponse,
    revalidate,
  });
  const product = response.products?.find((item) => item.id === id);
  return product ? mapMedusaProduct(product) : null;
}

/**
 * Разрешить несколько товаров по их handle одним серверным вызовом на товар.
 *
 * Запросы идут параллельно и по одному, а не одним фильтром-массивом: список
 * заведомо короткий (образ — это 3-4 позиции), ответы кэшируются тем же ISR,
 * что и карточка товара, а поведение не зависит от синтаксиса
 * массивных фильтров Store API.
 *
 * Порядок результата повторяет порядок `handles`; ненайденные и невалидные
 * товары выпадают — вызывающий код сам решает, что показать вместо них.
 */
export async function fetchMedusaProductsByHandles(
  handles: string[],
  revalidate?: number,
): Promise<Product[]> {
  const results = await Promise.all(
    handles.map((handle) => fetchMedusaProductByHandle(handle, undefined, revalidate)),
  );
  return results.filter((product): product is Product => product !== null);
}

/**
 * Fetch store product categories so the catalog can translate a URL slug (which
 * equals the Medusa category handle) into a category id for server-side filtering.
 */
export async function fetchMedusaCategories(signal?: AbortSignal): Promise<MedusaCategory[]> {
  const query = new URLSearchParams({ limit: "100", fields: "id,name,handle" });
  const response = await medusaRequest(
    `/store/product-categories?${query.toString()}`,
    { signal, parse: parseCategoriesResponse },
  );

  return (response.product_categories || []).flatMap((category) =>
    typeof category.name === "string" && typeof category.handle === "string"
      ? [{ id: category.id, name: category.name, handle: category.handle }]
      : [],
  );
}

export async function fetchMedusaCollections(signal?: AbortSignal): Promise<{ id: string; title: string; handle: string }[]> {
  const response = await medusaRequest("/store/collections?limit=100&fields=id,title,handle", {
    signal,
    parse: (data) => {
      if (!isRecord(data) || !Array.isArray(data.collections)) throw new Error("Invalid collections response");
      return data.collections.flatMap((item) => isRecord(item) && typeof item.id === "string" && typeof item.title === "string" && typeof item.handle === "string"
        ? [{ id: item.id, title: item.title, handle: item.handle }] : []);
    },
  });
  return response;
}

export async function createMedusaCart() {
  const regionId = await getRussianRegionId();
  const response = await medusaRequest("/store/carts", {
    method: "POST",
    body: regionId ? { region_id: regionId } : {},
    parse: parseCartResponse,
  });
  return response.cart;
}

export async function retrieveMedusaCart(cartId: string) {
  const response = await medusaRequest(`/store/carts/${cartId}`, {
    parse: parseCartResponse,
  });
  return response.cart;
}

export async function addMedusaCartLineItem(cartId: string, variantId: string, quantity: number) {
  const response = await medusaRequest(`/store/carts/${cartId}/line-items`, {
    method: "POST",
    body: { variant_id: variantId, quantity },
    parse: parseCartResponse,
  });
  return response.cart;
}

export async function updateMedusaCartLineItem(cartId: string, lineItemId: string, quantity: number) {
  const response = await medusaRequest(`/store/carts/${cartId}/line-items/${lineItemId}`, {
    method: "POST",
    body: { quantity },
    parse: parseCartResponse,
  });
  return response.cart;
}

export async function removeMedusaCartLineItem(cartId: string, lineItemId: string) {
  const response = await medusaRequest(`/store/carts/${cartId}/line-items/${lineItemId}`, {
    method: "DELETE",
    parse: parseLineItemDeleteResponse,
  });
  return response.parent;
}

export async function updateMedusaCart(cartId: string, body: Record<string, unknown>) {
  const response = await medusaRequest(`/store/carts/${cartId}`, {
    method: "POST",
    body,
    parse: parseCartResponse,
  });
  return response.cart;
}

/** Машинный идентификатор MVP-опции доставки (type.code в Medusa). Витрина
 * выбирает опцию по нему, а не по отображаемому имени: имя редактируется в
 * Admin и не является контрактом. Код проставляется скриптом импорта каталога. */
export const MVP_SHIPPING_OPTION_CODE = "mvp-ru";

export async function listMedusaShippingOptions(cartId: string) {
  // `amount` нужен, чтобы показать цену доставки ДО того, как способ выбран и
  // применён к корзине: иначе покупатель выбирает вслепую.
  const fields = encodeURIComponent("id,name,amount,type.code");
  const response = await medusaRequest(
    `/store/shipping-options?cart_id=${encodeURIComponent(cartId)}&fields=${fields}`,
    { parse: parseShippingOptionsResponse },
  );
  return response.shipping_options || [];
}

export async function addMedusaCartShippingMethod(cartId: string, optionId: string) {
  const response = await medusaRequest(`/store/carts/${cartId}/shipping-methods`, {
    method: "POST",
    body: { option_id: optionId },
    parse: parseCartResponse,
  });
  return response.cart;
}

export async function createMedusaPaymentCollection(cartId: string) {
  const response = await medusaRequest("/store/payment-collections", {
    method: "POST",
    body: { cart_id: cartId },
    parse: parsePaymentCollectionResponse,
  });
  return response.payment_collection;
}

/**
 * Последний рубеж перед созданием заказа: без настроенного провайдера сюда
 * доходить нечему, но если UI-гейт когда-нибудь обойдут, отказ произойдёт
 * здесь, а не в виде неоплаченного заказа в админке.
 */
export async function initializeMedusaPaymentSession(paymentCollectionId: string) {
  if (!isCheckoutEnabled) {
    throw new Error(
      "Оплата не настроена: NEXT_PUBLIC_MEDUSA_PAYMENT_PROVIDER_ID не задан " +
        `или указывает на встроенный провайдер ${SYSTEM_DEFAULT_PAYMENT_PROVIDER_ID}.`,
    );
  }

  const endpoint = `/store/payment-collections/${paymentCollectionId}/payment-sessions`;
  const response = await medusaRequest(endpoint, {
    method: "POST",
    body: { provider_id: medusaPaymentProviderId },
    parse: parseInitializedPaymentCollectionResponse,
  });
  const session = response.payment_collection.payment_sessions?.find(
    (candidate) => candidate.provider_id === medusaPaymentProviderId,
  );
  if (!session) {
    throw new MedusaContractError(
      endpoint,
      "payment_collection.payment_sessions",
      `does not contain provider ${medusaPaymentProviderId}`,
    );
  }

  return session;
}

export async function completeMedusaCart(cartId: string) {
  return medusaRequest(`/store/carts/${cartId}/complete`, {
    method: "POST",
    body: {},
    parse: parseCompleteCartResponse,
  });
}
