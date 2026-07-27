export interface ProductOption {
  title: string;
  values: string[];
}

export interface ProductVariant {
  variantId: string;
  sku: string | null;
  options: Record<string, string>;
  price: number;
  available: boolean;
}

export interface Product {
  id: string;
  productId: string;
  handle: string;
  name: string;
  /**
   * Описание товара из Medusa. Необязательное: скрипт импорта каталога его не
   * заполняет, текст появляется только когда его напишут в админке. Отсутствие
   * описания — валидное состояние, витрина в этом случае не показывает блок.
   */
  description?: string;
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
