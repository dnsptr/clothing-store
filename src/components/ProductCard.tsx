"use client";

import { useState } from "react";
import Link from "next/link";
import { useCart } from "../context/CartContext";
import type { Product } from "../data/mockData";
import { formatPrice } from "../lib/format";
import ProductImageGallery from "./ProductImageGallery";
import styles from "./ProductCard.module.css";

interface ProductCardProps {
  product: Product;
  headingLevel?: "h2" | "h3";
  imageSizes?: string;
  variant?: "catalog" | "home";
}

function BookmarkIcon({ active }: { active: boolean }) {
  return (
    <svg className={styles.bookmarkIcon} fill={active ? "currentColor" : "none"} stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.35" d="M6.5 4.75h11v15l-5.5-3.4-5.5 3.4v-15Z" />
    </svg>
  );
}

export default function ProductCard({
  product,
  headingLevel = "h2",
  imageSizes = "(max-width: 768px) 50vw, (max-width: 1200px) 33vw, 25vw",
  variant = "catalog",
}: ProductCardProps) {
  const [activeColorIndex, setActiveColorIndex] = useState(0);
  const { isFavorite, toggleFavorite } = useCart();
  const isSaved = isFavorite(product.id);
  const productHref = `/product/${product.id}`;
  const Heading = headingLevel;

  return (
    <article className={`${styles.card} ${variant === "home" ? styles.cardHome : ""}`}>
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
        <ProductImageGallery
          images={product.images}
          alt={product.name}
          href={productHref}
          sizes={imageSizes}
          variant={variant}
        />
      </div>

      <div className={styles.info}>
        <Heading className={styles.name} title={product.name}>
          <Link href={productHref}>{product.name}</Link>
        </Heading>
        <span className={styles.price}>{formatPrice(product.price)}</span>

        {product.colors.length > 0 && (
          <div className={styles.colors}>
            {product.colors.map((color, index) => (
              <button
                key={color.name}
                className={`${styles.colorDot} ${
                  activeColorIndex === index ? styles.colorDotActive : ""
                }`}
                style={{ backgroundColor: color.hex }}
                title={color.name}
                type="button"
                onClick={() => setActiveColorIndex(index)}
                aria-label={`Выбрать цвет ${color.name}`}
              />
            ))}
          </div>
        )}
      </div>
    </article>
  );
}
