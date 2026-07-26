export function withBasePath(path: string) {
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH;

  if (!basePath || !path.startsWith("/")) {
    return path;
  }

  return `${basePath}${path}`;
}

/** Заглушка для товара без изображений. */
export const PRODUCT_IMAGE_PLACEHOLDER = "/placeholder-product.svg";

/**
 * Источник для `next/image` по списку изображений товара.
 *
 * `images[0]` типизирован как `string` даже у пустого массива
 * (`noUncheckedIndexedAccess` не включён), поэтому индексация напрямую отдавала
 * `undefined` в `src` и роняла рендер. Товар без картинок — штатная ситуация:
 * его может завести менеджер в Admin, и он же собирается из строки корзины,
 * когда позиция не нашлась в загруженной странице каталога.
 */
export function productImageSrc(images: string[] | undefined, index = 0) {
  const source = images?.[index];
  return withBasePath(source && source.trim() ? source : PRODUCT_IMAGE_PLACEHOLDER);
}
