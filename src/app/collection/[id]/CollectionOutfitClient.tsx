"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useCart } from "../../../context/CartContext";
import { Product } from "../../../data/mockData";
import { formatPrice } from "../../../lib/format";
import styles from "./collection.module.css";

function BookmarkIcon({ active }: { active: boolean }) {
  return (
    <svg className={styles.bookmarkIcon} fill={active ? "currentColor" : "none"} stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.35" d="M6.5 4.75h11v15l-5.5-3.4-5.5 3.4v-15Z" />
    </svg>
  );
}

export default function CollectionOutfitClient({ products }: { products: Product[] }) {
  const [activeColors, setActiveColors] = useState<Record<string, number>>({});
  const { isFavorite, toggleFavorite } = useCart();

  const handleColorSelect = (productId: string, colorIndex: number) => {
    setActiveColors((prev) => ({
      ...prev,
      [productId]: colorIndex,
    }));
  };

  return (
    <div className={styles.grid}>
      {products.map((product) => {
        const activeIndex = activeColors[product.id] ?? 0;
        const isSaved = isFavorite(product.id);

        return (
          <article key={product.id} className={styles.card}>
            <div className={styles.preview}>
              {product.isNew && <span className={styles.badge}>New</span>}
              <button
                className={styles.wishlist}
                type="button"
                onClick={() => toggleFavorite(product.id)}
                aria-pressed={isSaved}
                aria-label="Добавить в избранное"
              >
                <BookmarkIcon active={isSaved} />
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
                  sizes="(max-width: 768px) 50vw, (max-width: 1200px) 33vw, 25vw"
                  className={styles.image}
                  draggable={false}
                />
              </Link>
            </div>

            <div className={styles.cardInfo}>
              <h3 className={styles.productName} title={product.name}>
                <Link href={`/product/${product.id}`}>{product.name}</Link>
              </h3>
              <span className={styles.price}>{formatPrice(product.price)}</span>

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
                      type="button"
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
  );
}
