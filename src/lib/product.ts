export interface ProductOption {
  title: string;
  values: string[];
}

export interface ProductVariant {
  variantId: string;
  sku: string;
  options: Record<string, string>;
  price: number;
  available: boolean;
}

export interface Product {
  id: string;
  productId: string;
  handle: string;
  name: string;
  price: number;
  category: string;
  categorySlug: string;
  materialSlugs: string[];
  availableSizes: string[];
  images: string[];
  colors: { name: string; hex: string }[];
  options: ProductOption[];
  variants: ProductVariant[];
  available: boolean;
  isNew?: boolean;
  isSoldOut?: boolean;
}
