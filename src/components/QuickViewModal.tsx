"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { Product } from "../data/mockData";
import { useCart } from "../context/CartContext";
import styles from "./QuickViewModal.module.css";

interface QuickViewModalProps {
  product: Product | null;
  onClose: () => void;
}

const AVAILABLE_SIZES = ["XS", "S", "M", "L", "XL"];

export default function QuickViewModal({ product, onClose }: QuickViewModalProps) {
  const { addToCart } = useCart();
  const [selectedColor, setSelectedColor] = useState<{ name: string; hex: string } | null>(null);
  const [selectedSize, setSelectedSize] = useState<string>("");
  const [error, setError] = useState<string>("");

  // Initialize selected color when product changes
  useEffect(() => {
    if (product && product.colors && product.colors.length > 0) {
      setSelectedColor(product.colors[0]);
      setSelectedSize("");
      setError("");
    }
  }, [product]);

  // Close modal on ESC key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && product) {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [product, onClose]);

  if (!product) return null;

  const handleAddToCart = () => {
    if (!selectedSize) {
      setError("Пожалуйста, выберите размер");
      return;
    }

    if (!selectedColor) return;

    setError("");
    addToCart({
      product,
      selectedSize,
      selectedColor,
      quantity: 1,
    });
    
    // Close modal after adding
    onClose();
  };

  const formatPrice = (price: number) => {
    return price.toLocaleString("ru-RU") + " ₽";
  };

  return (
    <div
      className={`${styles.overlay} ${product ? styles.overlayOpen : ""}`}
      onClick={onClose}
    >
      <div
        className={styles.modal}
        onClick={(e) => e.stopPropagation()} // Prevent closing when clicking modal content
      >
        {/* Close Button */}
        <button className={styles.closeBtn} onClick={onClose} aria-label="Закрыть">
          <svg
            className={styles.closeIcon}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="1.5"
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>

        {/* Left Side: Image */}
        <div className={styles.imageSection}>
          <Image
            src={product.images[0]}
            alt={product.name}
            fill
            sizes="(max-width: 768px) 100vw, 50vw"
            className={styles.productImage}
            priority
          />
        </div>

        {/* Right Side: Options & Actions */}
        <div className={styles.infoSection}>
          <div className={styles.details}>
            <div className={styles.header}>
              <span className={styles.category}>{product.category}</span>
              <h2 className={styles.title}>{product.name}</h2>
              <span className={styles.price}>{formatPrice(product.price)}</span>
            </div>

            <p className={styles.description}>
              Изделие выполнено из премиального материала с заботой о комфорте. Отличается лаконичным кроем, который легко вписывается в базовый гардероб.
              <br />
              <br />
              • Свободный силуэт
              <br />• 100% премиум-качество
            </p>

            {/* Colors Selection */}
            {product.colors && product.colors.length > 0 && (
              <div className={styles.colors}>
                <h3 className={styles.optionTitle}>Цвет: {selectedColor?.name}</h3>
                <div className={styles.colorList}>
                  {product.colors.map((color) => (
                    <button
                      key={color.name}
                      className={`${styles.colorDot} ${
                        selectedColor?.hex === color.hex ? styles.colorDotActive : ""
                      }`}
                      style={{ backgroundColor: color.hex }}
                      onClick={() => setSelectedColor(color)}
                      aria-label={`Выбрать цвет ${color.name}`}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Sizes Selection */}
            <div className={styles.sizes}>
              <h3 className={styles.optionTitle}>Размер</h3>
              <div className={styles.sizeList}>
                {AVAILABLE_SIZES.map((size) => (
                  <button
                    key={size}
                    className={`${styles.sizeBtn} ${
                      selectedSize === size ? styles.sizeBtnActive : ""
                    }`}
                    onClick={() => {
                      setSelectedSize(size);
                      setError(""); // Clear error when size is selected
                    }}
                  >
                    {size}
                  </button>
                ))}
              </div>
              {error && <span className={styles.error}>{error}</span>}
            </div>
          </div>

          {/* Add to Cart Button */}
          <button className={styles.addToCartBtn} onClick={handleAddToCart}>
            Добавить в корзину
          </button>
        </div>
      </div>
    </div>
  );
}
