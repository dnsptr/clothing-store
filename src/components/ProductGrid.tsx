"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useCart } from "../context/CartContext";
import { MOCK_PRODUCTS } from "../data/mockData";
import { CATALOG_SECTIONS } from "../lib/catalog";
import { formatPrice as formatCurrency } from "../lib/format";
import styles from "./ProductGrid.module.css";

export default function ProductGrid() {
  const [activeColors, setActiveColors] = useState<Record<string, number>>({});
  const { isFavorite, toggleFavorite } = useCart();

  const handleColorSelect = (productId: string, colorIndex: number) => {
    setActiveColors((prev) => ({
      ...prev,
      [productId]: colorIndex,
    }));
  };

  return (
    <section className={styles.section}>
      <div className={`${styles.container} container`}>
        <div className={styles.titleSection}>
          <div>
            <span className={styles.subtitle}>Подборка сезона</span>
            <h2 className={styles.title}>Новинки</h2>
          </div>
          <Link href={CATALOG_SECTIONS.new.href} className={styles.allLink}>
            Смотреть все
          </Link>
        </div>

        <div className={styles.grid}>
          {MOCK_PRODUCTS.slice(0, 4).map((product) => {
            const activeIndex = activeColors[product.id] ?? 0;
            const isSaved = isFavorite(product.id);

            return (
              <article key={product.id} className={styles.card}>
                <div className={styles.imageContainer}>
                  {product.isNew && <span className={styles.badge}>New</span>}

                  <button
                    className={styles.wishlistBtn}
                    onClick={() => toggleFavorite(product.id)}
                    aria-pressed={isSaved}
                    aria-label="Добавить в избранное"
                  >
                    <svg className={styles.wishlistIcon} fill={isSaved ? "currentColor" : "none"} stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.35" d="M6.5 4.75h11v15l-5.5-3.4-5.5 3.4v-15Z" />
                    </svg>
                  </button>

                  <Link
                    className={styles.imageButton}
                    href={`/product/${product.id}`}
                    aria-label={`Открыть страницу товара: ${product.name}`}
                  >
                    <Image
                      src={product.images[0]}
                      alt={product.name}
                      fill
                      sizes="(max-width: 768px) 50vw, (max-width: 1180px) 33vw, 25vw"
                      className={styles.image}
                    />
                  </Link>
                </div>

                <div className={styles.info}>
                  <h3 className={styles.name} title={product.name}>
                    <Link href={`/product/${product.id}`}>{product.name}</Link>
                  </h3>
                  <span className={styles.price}>{formatCurrency(product.price)}</span>

                  {product.colors.length > 0 && (
                    <div className={styles.colors}>
                      {product.colors.map((color, index) => (
                        <button
                          key={color.name}
                          className={`${styles.colorDot} ${
                            activeIndex === index ? styles.colorDotActive : ""
                          }`}
                          style={{ backgroundColor: color.hex }}
                          title={color.name}
                          onClick={() => handleColorSelect(product.id, index)}
                          aria-label={`Выбрать цвет ${color.name}`}
                        />
                      ))}
                    </div>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      </div>

    </section>
  );
}
