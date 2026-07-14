"use client";

import { useState } from "react";
import Link from "next/link";
import ProductImageGallery from "../../components/ProductImageGallery";
import { useCart } from "../../context/CartContext";
import { MOCK_PRODUCTS } from "../../data/mockData";
import { formatPrice } from "../../lib/format";
import { AVAILABLE_SIZES } from "../../lib/shop";
import styles from "./favorites.module.css";

export default function FavoritesClient() {
  const {
    addToCart,
    favoriteProductIds,
    removeFavorite,
  } = useCart();
  const [selectedSizes, setSelectedSizes] = useState<Record<string, string>>({});

  const favoriteProducts = MOCK_PRODUCTS.filter((product) =>
    favoriteProductIds.includes(product.id)
  );

  if (favoriteProducts.length === 0) {
    return (
      <main className={styles.page}>
        <section className={styles.emptyState}>
          <h1>Избранное пусто</h1>
          <p>Сохраняйте понравившиеся изделия, чтобы вернуться к ним позже.</p>
          <Link href="/catalog" className={styles.catalogLink}>
            Перейти в каталог
          </Link>
        </section>
      </main>
    );
  }

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <nav className={styles.breadcrumbs} aria-label="Хлебные крошки">
          <Link href="/">Главная</Link>
          <span>/</span>
          <span>Избранное</span>
        </nav>

        <section className={styles.titleBlock}>
          <h1 className={styles.title}>Избранное</h1>
          <span className={styles.count}>{favoriteProducts.length}</span>
        </section>

        <section className={styles.grid} aria-label="Избранные товары">
          {favoriteProducts.map((product) => {
            const selectedSize = selectedSizes[product.id] ?? AVAILABLE_SIZES[1];
            const selectedColor = product.colors[0];

            return (
              <article key={product.id} className={styles.card}>
                <div className={styles.preview}>
                  <button
                    type="button"
                    className={styles.removeButton}
                    onClick={() => removeFavorite(product.id)}
                    aria-label={`Удалить ${product.name} из избранного`}
                  >
                    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.35" d="m6.5 6 12 12M18 6 6 18" />
                    </svg>
                  </button>
                  <ProductImageGallery
                    images={product.images}
                    alt={product.name}
                    href={`/product/${product.id}`}
                    sizes="(max-width: 768px) 50vw, (max-width: 1180px) 33vw, 25vw"
                  />
                </div>

                <div className={styles.info}>
                  <Link href={`/product/${product.id}`} className={styles.name}>
                    {product.name}
                  </Link>
                  <span className={styles.price}>{formatPrice(product.price)}</span>

                  <div className={styles.sizeList} aria-label={`Размер для ${product.name}`}>
                    {AVAILABLE_SIZES.map((size) => (
                      <button
                        key={size}
                        type="button"
                        className={`${styles.sizeButton} ${
                          selectedSize === size ? styles.sizeButtonActive : ""
                        }`}
                        onClick={() =>
                          setSelectedSizes((previous) => ({
                            ...previous,
                            [product.id]: size,
                          }))
                        }
                        aria-pressed={selectedSize === size}
                      >
                        {size}
                      </button>
                    ))}
                  </div>

                  <button
                    type="button"
                    className={styles.addButton}
                    onClick={() =>
                      addToCart({
                        product,
                        selectedSize,
                        selectedColor,
                        quantity: 1,
                      })
                    }
                  >
                    Добавить в корзину
                  </button>
                </div>
              </article>
            );
          })}
        </section>
      </div>
    </main>
  );
}
