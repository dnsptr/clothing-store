"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import type { Product } from "../../../data/mockData";
import { useCatalog } from "../../../context/CatalogContext";
import { useCart } from "../../../context/CartContext";
import SizeGuideModal from "../../../components/SizeGuideModal";
import { productImageSrc, withBasePath } from "../../../lib/assets";
import { formatPrice } from "../../../lib/format";
import { fetchMedusaProductByFrontendId, isMedusaConfigured } from "../../../lib/medusa";
import styles from "./product.module.css";

function BookmarkIcon({ active }: { active: boolean }) {
  return (
    <svg fill={active ? "currentColor" : "none"} stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.25" d="M6.5 4.75h11v15l-5.5-3.4-5.5 3.4v-15Z" />
    </svg>
  );
}

function Breadcrumbs({ productName }: { productName?: string }) {
  return (
    <div className={styles.breadcrumbs}>
      <Link href="/">Главная</Link>
      <span>/</span>
      <span>Каталог</span>
      <span>/</span>
      <span>{productName ?? "Товар"}</span>
    </div>
  );
}

function ProductSkeleton() {
  return (
    <div
      className={styles.productGrid}
      role="status"
      aria-busy="true"
      aria-label="Загрузка товара"
    >
      <div className={styles.gallery} aria-hidden="true">
        {Array.from({ length: 2 }).map((_, index) => (
          <div key={index} className={styles.skeletonImage} />
        ))}
      </div>
      <aside className={styles.sidebar} aria-hidden="true">
        <div className={styles.details}>
          <div className={`${styles.skeletonLine} ${styles.skeletonLineShort}`} />
          <div className={`${styles.skeletonLine} ${styles.skeletonLineWide}`} />
          <div className={styles.skeletonLine} />
          <div className={styles.skeletonBlock} />
          <div className={styles.skeletonButton} />
        </div>
      </aside>
    </div>
  );
}

function ProductUnavailable() {
  return (
    <div className={styles.unavailable} role="status">
      <h1 className={styles.unavailableTitle}>Товар недоступен</h1>
      <p className={styles.unavailableText}>
        Этого товара нет в каталоге или он больше не продаётся. Посмотрите другие модели в нашем каталоге.
      </p>
      <Link href="/catalog" className={styles.unavailableLink}>
        Вернуться в каталог
      </Link>
    </div>
  );
}

interface ProductDetailClientProps {
  /** Route param. Always present, even when no product could be resolved. */
  productId: string;
  /**
   * Product resolved on the server — from Medusa in medusa mode, from the demo
   * catalog in mock mode. Non-null in the common case, which is what removed the
   * old "mock shell + client refetch" wrapper: the HTML now already contains the
   * real product, so there is nothing to re-resolve and nothing to flicker.
   */
  initialProduct: Product | null;
  /** Medusa was unreachable during server rendering (FE-002 / ADR-001 §6). */
  serverError?: boolean;
}

export default function ProductDetailClient({
  productId,
  initialProduct,
  serverError = false,
}: ProductDetailClientProps) {
  const { products, source, status } = useCatalog();
  const medusaProduct = products.find((item) => item.id === productId);

  // FE-004 A2: the global catalog context only holds the FIRST page of products,
  // so a product beyond that page is absent from `products`. The server now
  // resolves the product for us, so this client fallback only still fires where
  // no server resolution exists: the static export target, and any case where
  // the server render failed. State is keyed by product id so a stale result
  // never leaks across navigations (and so we can derive loading without a
  // set-state-in-effect violation).
  const [selfResult, setSelfResult] = useState<{ id: string; product: Product | null } | null>(null);
  const [selfErrorId, setSelfErrorId] = useState<string | null>(null);

  const resolvedForThisId = selfResult?.id === productId;
  const erroredForThisId = selfErrorId === productId;
  const shouldSelfFetch =
    isMedusaConfigured && !initialProduct && !medusaProduct && status !== "loading";
  const isSelfLoading = shouldSelfFetch && !resolvedForThisId && !erroredForThisId;

  useEffect(() => {
    if (!shouldSelfFetch || resolvedForThisId || erroredForThisId) return;

    const controller = new AbortController();
    fetchMedusaProductByFrontendId(productId, controller.signal)
      .then((found) => {
        if (controller.signal.aborted) return;
        setSelfResult({ id: productId, product: found });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        if (error instanceof DOMException && error.name === "AbortError") return;
        console.error("[PDP] Не удалось загрузить товар по handle.", error);
        setSelfErrorId(productId);
      });

    return () => controller.abort();
  }, [shouldSelfFetch, resolvedForThisId, erroredForThisId, productId]);

  // Mock mode: the server already handed us the demo product.
  if (source === "mock") {
    return initialProduct ? (
      <>
        <Breadcrumbs productName={initialProduct.name} />
        <ProductView product={initialProduct} />
      </>
    ) : (
      <>
        <Breadcrumbs />
        <ProductUnavailable />
      </>
    );
  }

  // Medusa mode: render ONLY a product built from Medusa data — never the mock
  // shell (FE-002 / ADR-001 §6). The server-resolved product wins over the
  // context copy so the client renders exactly the markup that was sent.
  const product =
    initialProduct ??
    medusaProduct ??
    (selfResult && selfResult.id === productId ? selfResult.product : null);

  if (product) {
    return (
      <>
        <Breadcrumbs productName={product.name} />
        <ProductView product={product} />
      </>
    );
  }

  return (
    <>
      <Breadcrumbs />
      {!serverError && (status === "loading" || isSelfLoading) ? (
        <ProductSkeleton />
      ) : (
        <ProductUnavailable />
      )}
    </>
  );
}

function ProductView({ product }: { product: Product }) {
  const { products } = useCatalog();
  const { addToCart, isCartMutating } = useCart();
  const colorValues = product.options.find((option) => option.title === "Цвет")?.values ?? [];
  const colors = colorValues.map(
    (name) => product.colors.find((color) => color.name === name) ?? { name, hex: "#808080" },
  );
  const sizes = product.options.find((option) => option.title === "Размер")?.values ?? [];

  // FE-006 B3: a product with exactly one size (incl. "One Size") has no real
  // size choice — auto-select it, present the size as a static badge, and never
  // demand "выберите размер". `requiresSizeChoice` gates the interactive grid.
  const isSingleSize = sizes.length === 1;
  const soleSize = sizes[0] ?? "";
  const requiresSizeChoice = sizes.length > 1;

  const defaultColor =
    colors.find((color) =>
      product.variants.some(
        (variant) => variant.available && variant.options.Цвет === color.name,
      ),
    ) ?? colors[0] ?? null;
  const [selectedColor, setSelectedColor] = useState(defaultColor);
  const [selectedSize, setSelectedSize] = useState(isSingleSize ? soleSize : "");
  const [isSizeGuideOpen, setIsSizeGuideOpen] = useState(false);
  const [savedPhotoIndexes, setSavedPhotoIndexes] = useState<number[]>([]);

  const lookProducts = products.filter((item) => item.id !== product.id).slice(0, 2);

  // The selected variant matches only along the dimensions this product actually
  // has (a product may lack a size or a colour axis).
  const selectedVariant = product.variants.find(
    (variant) =>
      variant.available &&
      (sizes.length === 0 || variant.options.Размер === selectedSize) &&
      (colorValues.length === 0 || variant.options.Цвет === selectedColor?.name),
  );

  // FE-006 B1/B2: cross availability. A size/colour is offered only when at least
  // one AVAILABLE variant exists for it given the current opposite-axis choice.
  // Combinations that are out of stock OR that don't exist at all resolve to
  // "unavailable" and are rendered disabled (never hidden).
  const isColorAvailable = (colorName: string) =>
    product.variants.some(
      (variant) =>
        variant.available &&
        variant.options.Цвет === colorName &&
        (!selectedSize || variant.options.Размер === selectedSize),
    );

  const isSizeAvailable = (size: string) =>
    product.variants.some(
      (variant) =>
        variant.available &&
        variant.options.Размер === size &&
        (!selectedColor || variant.options.Цвет === selectedColor.name),
    );

  // FE-006 B4: the primary action is enabled only for a fully-selected, existing
  // and available combination (and while the cart isn't mutating).
  const canAddToCart = Boolean(selectedVariant && selectedColor) && !isCartMutating;

  // Артикул — только настоящий SKU: выбранного варианта, а пока выбор не сделан —
  // единственного варианта товара. Раньше здесь стоял один и тот же выдуманный
  // номер для всех товаров: по нему покупателя невозможно было ни найти в заказе,
  // ни свериться с остатком. Нет SKU — строки нет вовсе.
  const skuVariant =
    selectedVariant ?? (product.variants.length === 1 ? product.variants[0] : undefined);
  const sku = skuVariant?.sku?.trim() ?? "";

  // Описание приходит из карточки товара в Medusa (скрипт импорта его не
  // проставляет и не затирает — текст правится в админке). Пока текста нет,
  // блок не рендерится: придумывать состав и свойства изделия витрина не вправе.
  const descriptionParagraphs = (product.description ?? "")
    .split(/\r?\n+/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

  // FE-006 B3/B5: guidance shown only when a real size choice is still pending
  // AND at least one size is actually available (so a fully sold-out product does
  // not nudge the shopper toward a choice they can't make). Russian copy, muted
  // style — never shown for single-size products.
  const sizeHint =
    requiresSizeChoice && !selectedSize && sizes.some(isSizeAvailable)
      ? "Выберите размер"
      : "";

  const handleSelectColor = (color: { name: string; hex: string }) => {
    setSelectedColor(color);
    // Keep the selection coherent: if the chosen colour has no available variant
    // for the currently picked size, drop the size so the UI can never hold an
    // unavailable combination (single-size products stay auto-selected).
    if (
      selectedSize &&
      !product.variants.some(
        (variant) =>
          variant.available &&
          variant.options.Цвет === color.name &&
          variant.options.Размер === selectedSize,
      )
    ) {
      setSelectedSize(isSingleSize ? soleSize : "");
    }
  };

  const handleAddToCart = () => {
    // Guarded by the disabled button (B4); this is a defensive no-op for
    // keyboard/programmatic activation of an incomplete selection.
    if (!selectedVariant || !selectedColor) return;

    addToCart({
      product,
      selectedSize,
      selectedColor,
      variantId: selectedVariant.variantId,
      quantity: 1,
    });
  };

  const toggleSavedPhoto = (index: number) => {
    setSavedPhotoIndexes((previous) =>
      previous.includes(index) ? previous.filter((item) => item !== index) : [...previous, index]
    );
  };

  return (
    <>
      <div className={styles.productGrid}>
        <div className={styles.gallery} aria-label="Фотографии изделия">
          {product.images.map((imageUrl, index) => {
            const isSaved = savedPhotoIndexes.includes(index);

            return (
              <figure className={styles.imageWrapper} key={imageUrl}>
                <Image
                  src={withBasePath(imageUrl)}
                  alt={`${product.name}, ракурс ${index + 1}`}
                  fill
                  sizes="(max-width: 767px) 100vw, (max-width: 1100px) 58vw, 560px"
                  className={styles.image}
                  priority={index < 2}
                />
                <button
                  type="button"
                  className={`${styles.photoBookmark} ${isSaved ? styles.photoBookmarkActive : ""}`}
                  onClick={() => toggleSavedPhoto(index)}
                  aria-label={isSaved ? "Убрать фото из избранного" : "Сохранить фото в избранное"}
                  aria-pressed={isSaved}
                >
                  <BookmarkIcon active={isSaved} />
                </button>
              </figure>
            );
          })}
        </div>

        <aside className={styles.sidebar} aria-label="Информация об изделии">
          <div className={styles.details}>
            <div className={styles.productHeader}>
              <p className={styles.category}>{product.category}</p>
              <h1 className={styles.title}>{product.name}</h1>
              <p className={styles.price}>{formatPrice(selectedVariant?.price ?? product.price)}</p>
            </div>

            <section className={styles.optionSection} aria-labelledby="color-title">
              <h2 className={styles.optionTitle} id="color-title">
                Цвет: {selectedColor?.name}
              </h2>
              <div className={styles.colorList}>
                {colors.map((color) => {
                  const isDisabled = !isColorAvailable(color.name);
                  const isSelected = !isDisabled && selectedColor?.name === color.name;

                  return (
                    <button
                      type="button"
                      key={color.name}
                      className={`${styles.colorDot} ${isSelected ? styles.colorDotActive : ""} ${
                        isDisabled ? styles.colorDotDisabled : ""
                      }`}
                      style={{ backgroundColor: color.hex }}
                      onClick={() => {
                        if (isDisabled) return;
                        handleSelectColor(color);
                      }}
                      aria-label={`Выбрать цвет ${color.name}`}
                      aria-pressed={isSelected}
                      aria-disabled={isDisabled}
                    />
                  );
                })}
              </div>
            </section>

            {sizes.length > 0 && (
              <section className={styles.optionSection} aria-labelledby="size-title">
                <div className={styles.sizeSectionHeader}>
                  <h2 className={styles.optionTitle} id="size-title">
                    Размер
                  </h2>
                  <button type="button" className={styles.sizeGuideLink} onClick={() => setIsSizeGuideOpen(true)}>
                    Таблица размеров
                  </button>
                </div>
                {requiresSizeChoice ? (
                  <div className={styles.sizeList} role="group" aria-label="Выбор размера">
                    {sizes.map((size) => {
                      const isDisabled = !isSizeAvailable(size);
                      const isSelected = !isDisabled && selectedSize === size;

                      return (
                        <button
                          type="button"
                          key={size}
                          className={`${styles.sizeBtn} ${isSelected ? styles.sizeBtnActive : ""} ${
                            isDisabled ? styles.sizeBtnDisabled : ""
                          }`}
                          onClick={() => {
                            if (isDisabled) return;
                            setSelectedSize(size);
                          }}
                          aria-pressed={isSelected}
                          aria-disabled={isDisabled}
                        >
                          {size}
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  // FE-006 B3: single size → inactive badge, no size prompt.
                  <span
                    className={styles.sizeBadge}
                    aria-label={`Единственный доступный размер: ${soleSize}`}
                  >
                    {soleSize}
                  </span>
                )}
                {sizeHint && <p className={styles.selectionHint}>{sizeHint}</p>}
              </section>
            )}

            <button
              type="button"
              className={styles.addToCartBtn}
              onClick={handleAddToCart}
              disabled={!canAddToCart}
              aria-busy={isCartMutating}
            >
              Добавить в корзину
            </button>

            {sku && (
              <div className={styles.productFacts}>
                <p>Артикул: {sku}</p>
              </div>
            )}

            {descriptionParagraphs.length > 0 && (
              <div className={styles.description}>
                {descriptionParagraphs.map((paragraph, index) => (
                  <p key={index}>{paragraph}</p>
                ))}
              </div>
            )}

            {!!product.characteristics?.length && (
              <section className={styles.characteristics} aria-label="Характеристики изделия">
                <h2 className={styles.optionTitle}>Информация об изделии</h2>
                <dl>{product.characteristics.map((item) => (
                  <div key={item.label}><dt>{item.label}</dt><dd>{item.value}</dd></div>
                ))}</dl>
                {product.registryUrl && <a href={product.registryUrl} target="_blank" rel="noopener noreferrer">Запись в реестре деклараций и сертификатов</a>}
              </section>
            )}
            {!!product.labelImages?.length && <details className={styles.characteristics}>
              <summary>Этикетки и вшивные ярлыки</summary>
              <div className={styles.labelImages}>{product.labelImages.map((image, index) => <a key={`${image.url}-${index}`} href={withBasePath(image.url)} target="_blank" rel="noopener noreferrer" aria-label={`Открыть фото этикетки ${index + 1}`}>
                <Image src={withBasePath(image.url)} alt={`Этикетка ${product.name}, ${index + 1}`} width={400} height={500} sizes="(max-width: 768px) 45vw, 200px" />
              </a>)}</div>
            </details>}
          </div>
        </aside>
      </div>

      <section className={styles.outfit} aria-labelledby="outfit-title">
        <h2 className={styles.outfitTitle} id="outfit-title">
          Весь образ на фото
        </h2>
        <div className={styles.outfitGrid}>
          {lookProducts.map((item) => (
            <article className={styles.outfitCard} key={item.id}>
              <Link href={`/product/${item.id}`} className={styles.outfitImageLink} aria-label={item.name}>
                <Image src={productImageSrc(item.images)} alt={item.name} fill sizes="264px" className={styles.outfitImage} />
              </Link>
              <Link href={`/product/${item.id}`} className={styles.outfitName}>
                {item.name}
              </Link>
              <p className={styles.outfitPrice}>{formatPrice(item.price)}</p>
            </article>
          ))}
        </div>
      </section>

      <SizeGuideModal isOpen={isSizeGuideOpen} onClose={() => setIsSizeGuideOpen(false)} />
    </>
  );
}
