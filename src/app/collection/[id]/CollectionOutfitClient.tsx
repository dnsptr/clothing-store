"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useCart } from "../../../context/CartContext";
import { Product } from "../../../data/mockData";
import { formatPrice } from "../../../lib/format";
import styles from "./collection.module.css";
import cardStyles from "../../../components/ProductGrid.module.css";

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
    <>
      <div className={styles.grid}>
        {products.map((product) => {
          const activeIndex = activeColors[product.id] ?? 0;
          const isSaved = isFavorite(product.id);

          return (
            <div key={product.id} className={cardStyles.card}>
              {/* Product Card Image */}
              <div className={cardStyles.imageContainer}>
                {product.isNew && <span className={cardStyles.badge}>New</span>}
                
                {/* Wishlist Button */}
                <button
                  className={cardStyles.wishlistBtn}
                  onClick={() => toggleFavorite(product.id)}
                  aria-pressed={isSaved}
                  aria-label="Добавить в избранное"
                >
                  <svg
                    className={cardStyles.wishlistIcon}
                    fill={isSaved ? "currentColor" : "none"}
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="1.5"
                      d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"
                    />
                  </svg>
                </button>

                <Link
                  href={`/product/${product.id}`}
                  className={cardStyles.imageButton}
                  aria-label={`Открыть страницу товара: ${product.name}`}
                >
                  <Image
                    src={product.images[0]}
                    alt={product.name}
                    fill
                    sizes="(max-width: 768px) 50vw, (max-width: 1024px) 33vw, 330px"
                    className={cardStyles.image}
                    draggable={false}
                  />
                </Link>
              </div>

              {/* Product Card Details */}
              <div className={cardStyles.info}>
                <span className={cardStyles.category}>{product.category}</span>
                <h3 className={cardStyles.name} title={product.name}>
                  <Link href={`/product/${product.id}`} style={{ display: "block" }}>
                    {product.name}
                  </Link>
                </h3>
                <span className={cardStyles.price}>{formatPrice(product.price)}</span>

                {/* Color swatches */}
                {product.colors && product.colors.length > 0 && (
                  <div className={cardStyles.colors}>
                    {product.colors.map((color, index) => (
                      <button
                        key={color.name}
                        className={`${cardStyles.colorDot} ${
                          activeIndex === index ? cardStyles.colorDotActive : ""
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
            </div>
          );
        })}
      </div>
    </>
  );
}
