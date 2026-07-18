import { MOCK_PRODUCTS, type Product } from "../data/mockData";

type UnknownRecord = Record<string, unknown>;

interface MedusaStoreProduct {
  id: string;
  title: string;
  handle: string;
  metadata?: unknown;
  images?: { url?: string | null }[];
  categories?: { name?: string | null; handle?: string | null }[];
  variants?: {
    calculated_price?: {
      calculated_amount?: number | null;
    } | null;
    options?: {
      value?: string | null;
      option?: { title?: string | null } | null;
    }[];
  }[];
}

interface MedusaProductsResponse {
  products?: MedusaStoreProduct[];
}

interface MedusaRegionsResponse {
  regions?: { id: string; currency_code?: string | null }[];
}

const backendUrl = process.env.NEXT_PUBLIC_MEDUSA_BACKEND_URL?.replace(/\/$/, "");
const publishableKey = process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY;
const configuredRegionId = process.env.NEXT_PUBLIC_MEDUSA_REGION_ID;

export const isMedusaConfigured = Boolean(backendUrl && publishableKey);

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
  const sizes = unique(
    (product.variants || []).flatMap((variant) =>
      (variant.options || [])
        .filter((option) => option.option?.title === "Размер")
        .flatMap((option) => (typeof option.value === "string" ? [option.value] : [])),
    ),
  );
  const images = (product.images || []).flatMap((image) =>
    typeof image.url === "string" ? [normalizeImageUrl(image.url)] : [],
  );
  const colors = getColors(metadata.colors);
  const price = product.variants?.find(
    (variant) => typeof variant.calculated_price?.calculated_amount === "number",
  )?.calculated_price?.calculated_amount;

  return {
    id: frontendId,
    name: product.title,
    price: typeof price === "number" ? price : (fallback?.price ?? 0),
    category: category?.name || fallback?.category || "Каталог",
    categorySlug: category?.handle || fallback?.categorySlug || "catalog",
    materialSlugs: getStringArray(metadata.material_slugs),
    availableSizes: sizes.length ? sizes : (fallback?.availableSizes ?? []),
    images: images.length ? images : (fallback?.images ?? []),
    colors: colors.length ? colors : (fallback?.colors ?? []),
    isNew: Boolean(metadata.is_new),
    isSoldOut: Boolean(metadata.is_sold_out),
  };
}

async function medusaRequest<T>(path: string, signal?: AbortSignal): Promise<T> {
  if (!backendUrl || !publishableKey) {
    throw new Error("Medusa storefront environment variables are not configured.");
  }

  const response = await fetch(`${backendUrl}${path}`, {
    headers: { "x-publishable-api-key": publishableKey },
    signal,
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
    signal,
  );
  return response.regions?.find((region) => region.currency_code === "rub")?.id;
}

export async function fetchMedusaProducts(signal?: AbortSignal) {
  const regionId = await getRussianRegionId(signal);
  const params = new URLSearchParams({
    limit: "100",
    fields: "*variants.calculated_price,*variants.options,*categories,*images,+metadata",
  });

  if (regionId) params.set("region_id", regionId);

  const response = await medusaRequest<MedusaProductsResponse>(
    `/store/products?${params.toString()}`,
    signal,
  );

  return (response.products || [])
    .map(mapMedusaProduct)
    .sort((first, second) => Number(first.id) - Number(second.id));
}
