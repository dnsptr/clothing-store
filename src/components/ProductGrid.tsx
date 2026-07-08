"use client";

import { useState } from "react";
import Image from "next/image";
import { MOCK_PRODUCTS, Product } from "../data/mockData";
import styles from "./ProductGrid.module.css";

export default function ProductGrid() {
  // Store active color selections for each product by product ID
  const [activeColors, setActiveColors] = useState<Record<string, number>>({});

  const handleColorSelect = (productId: string, colorIndex: number) => {
    setActiveColors((prev) => ({
      ...prev,
      [productId]: colorIndex,
    }));
  };

  const formatPrice = (price: number) => {
    return price.toLocaleString("ru-RU") + " ₽";
  };

  return (
    <section className={styles.section}>
      <div className="container">
        {/* Title Block */}
        <div className={styles.titleSection}>
          <span className={styles.subtitle}>Подборка сезона</span>
          <h2 className={styles.title}>Новые поступления</h2>
        </div>

        {/* Product Grid */}
        <div className={styles.grid}>
          {MOCK_PRODUCTS.map((product) => {
            const activeIndex = activeColors[product.id] ?? 0;
            return (
              <div key={product.id} className={styles.card}>
                {/* Image & Overlay Action */}
                <div className={styles.imageContainer}>
                  {product.isNew && <span className={styles.badge}>New</span>}
                  
                  {/* Wishlist Button */}
                  <button className={styles.wishlistBtn} aria-label="Добавить в избранное">
                    <svg
                      className={styles.wishlistIcon}
                      fill="none"
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

                  <Image
                    src={product.image}
                    alt={product.name}
                    fill
                    sizes="(max-width: 768px) 50vw, (max-width: 1024px) 33vw, 25vw"
                    className={styles.image}
                  />

                  {/* Hover Quick Add */}
                  <div className={styles.quickAdd}>Быстрый просмотр</div>
                </div>

                {/* Info Text */}
                <div className={styles.info}>
                  <span className={styles.category}>{product.category}</span>
                  <h3 className={styles.name} title={product.name}>
                    {product.name}
                  </h3>
                  <span className={styles.price}>{formatPrice(product.price)}</span>

                  {/* Color Swatches */}
                  {product.colors && product.colors.length > 0 && (
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
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
