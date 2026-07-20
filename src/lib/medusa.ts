import { MOCK_PRODUCTS, type Product } from "../data/mockData";

type UnknownRecord = Record<string, unknown>;

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
  items?: {
    id: string;
    variant_id?: string | null;
    quantity: number;
  }[];
}

interface MedusaCartResponse {
  cart: MedusaCart;
}

interface MedusaLineItemDeleteResponse {
  parent: MedusaCart;
}

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

function mapMedusaProduct(product: MedusaStoreProduct): Product {
  const metadata = isRecord(product.metadata) ? product.metadata : {};
  const frontendId =
    typeof metadata.frontend_id === "string" ? metadata.frontend_id : product.id;
  const fallback = MOCK_PRODUCTS.find((item) => item.id === frontendId);
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
  const available = variants.some((variant) => variant.available);

  return {
    id: frontendId,
    productId: product.id,
    handle: product.handle,
    name: product.title,
    price: typeof price === "number" ? price : (fallback?.price ?? 0),
    category: category?.name || fallback?.category || "Каталог",
    categorySlug: category?.handle || fallback?.categorySlug || "catalog",
    materialSlugs: getStringArray(metadata.material_slugs),
    availableSizes: sizes,
    images: images.length ? images : (fallback?.images ?? []),
    colors: colors.length ? colors : (fallback?.colors ?? []),
    options,
    variants,
    available,
    isNew: Boolean(metadata.is_new),
    isSoldOut: !available,
  };
}

async function medusaRequest<T>(
  path: string,
  options: { body?: unknown; method?: "DELETE" | "POST"; signal?: AbortSignal } = {},
): Promise<T> {
  if (!backendUrl || !publishableKey) {
    throw new Error("Medusa storefront environment variables are not configured.");
  }

  const response = await fetch(`${backendUrl}${path}`, {
    method: options.method,
    headers: {
      "x-publishable-api-key": publishableKey,
      ...(options.body ? { "content-type": "application/json" } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
    signal: options.signal,
  });

  if (!response.ok) {
    throw new Error(`Medusa request failed with status ${response.status}.`);
  }

  return response.json() as Promise<T>;
}

async function getRussianRegionId(signal?: AbortSignal) {
  if (configuredRegionId) return configuredRegionId;

  const response = await medusaRequest<MedusaRegionsResponse>(
    "/store/regions?limit=100",
    { signal },
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

  const response = await medusaRequest<MedusaProductsResponse>(`/store/products?${params.toString()}`, { signal });

  return (response.products || [])
    .map(mapMedusaProduct)
    .sort((first, second) => Number(first.id) - Number(second.id));
}

export async function createMedusaCart() {
  const regionId = await getRussianRegionId();
  const response = await medusaRequest<MedusaCartResponse>("/store/carts", {
    method: "POST",
    body: regionId ? { region_id: regionId } : {},
  });
  return response.cart;
}

export async function retrieveMedusaCart(cartId: string) {
  const response = await medusaRequest<MedusaCartResponse>(`/store/carts/${cartId}`);
  return response.cart;
}

export async function addMedusaCartLineItem(cartId: string, variantId: string, quantity: number) {
  const response = await medusaRequest<MedusaCartResponse>(`/store/carts/${cartId}/line-items`, {
    method: "POST",
    body: { variant_id: variantId, quantity },
  });
  return response.cart;
}

export async function updateMedusaCartLineItem(cartId: string, lineItemId: string, quantity: number) {
  const response = await medusaRequest<MedusaCartResponse>(`/store/carts/${cartId}/line-items/${lineItemId}`, {
    method: "POST",
    body: { quantity },
  });
  return response.cart;
}

export async function removeMedusaCartLineItem(cartId: string, lineItemId: string) {
  const response = await medusaRequest<MedusaLineItemDeleteResponse>(`/store/carts/${cartId}/line-items/${lineItemId}`, {
    method: "DELETE",
  });
  return response.parent;
}
