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
  items?: {
    id: string;
    variant_id?: string | null;
    quantity: number;
    unit_price?: number | null;
    total?: number | null;
  }[];
}

interface MedusaCartResponse {
  cart: MedusaCart;
}

interface MedusaLineItemDeleteResponse {
  parent: MedusaCart;
}

interface MedusaShippingOptionsResponse {
  shipping_options?: { id: string; name: string }[];
}

interface MedusaPaymentCollectionResponse {
  payment_collection: { id: string };
}

type MedusaCompleteCartResponse =
  | { type: "order"; order: { id: string; display_id?: number | null } }
  | { type: "cart"; error: { message: string } };

const backendUrl = process.env.NEXT_PUBLIC_MEDUSA_BACKEND_URL?.replace(/\/$/, "");
const publishableKey = process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY;
const configuredRegionId = process.env.NEXT_PUBLIC_MEDUSA_REGION_ID;

export const storefrontDataMode =
  process.env.NEXT_PUBLIC_DATA_MODE === "medusa" ? "medusa" : "mock";
export const isMedusaConfigured =
  storefrontDataMode === "medusa" && Boolean(backendUrl && publishableKey);

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
  const frontendId =
    typeof metadata.frontend_id === "string" ? metadata.frontend_id : product.id;
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
  return data as MedusaProductsResponse;
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

async function medusaRequest<T>(
  path: string,
  options: {
    body?: unknown;
    method?: "DELETE" | "POST";
    signal?: AbortSignal;
    parse?: (data: unknown, endpoint: string) => T;
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
    });
  } catch (error) {
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

async function getRussianRegionId(signal?: AbortSignal) {
  if (configuredRegionId) return configuredRegionId;

  const response = await medusaRequest(
    "/store/regions?limit=100",
    { signal, parse: parseRegionsResponse },
  );
  return response.regions?.find((region) => region.currency_code === "rub")?.id;
}

export async function fetchMedusaProducts(signal?: AbortSignal) {
  const regionId = await getRussianRegionId(signal);
  const params = new URLSearchParams({
    limit: "100",
    fields: "*variants.calculated_price,*variants.options,+variants.inventory_quantity,*options,*options.values,*categories,*images,+metadata",
  });

  if (regionId) params.set("region_id", regionId);

  const response = await medusaRequest(`/store/products?${params.toString()}`, {
    signal,
    parse: parseProductsResponse,
  });

  return (response.products || [])
    .flatMap((product) => {
      const mapped = mapMedusaProduct(product);
      return mapped ? [mapped] : [];
    })
    .sort((first, second) => Number(first.id) - Number(second.id));
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

export async function listMedusaShippingOptions(cartId: string) {
  const response = await medusaRequest(
    `/store/shipping-options?cart_id=${encodeURIComponent(cartId)}`,
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

export async function initializeMedusaPaymentSession(paymentCollectionId: string) {
  await medusaRequest(`/store/payment-collections/${paymentCollectionId}/payment-sessions`, {
    method: "POST",
    body: { provider_id: "pp_system_default" },
  });
}

export async function completeMedusaCart(cartId: string) {
  return medusaRequest(`/store/carts/${cartId}/complete`, {
    method: "POST",
    body: {},
    parse: parseCompleteCartResponse,
  });
}
