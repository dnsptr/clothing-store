"use client";

import { useState } from "react";
import Image from "next/image";
import { Product } from "../data/mockData";
import { useCart } from "../context/CartContext";
import { useBodyScrollLock } from "../hooks/useBodyScrollLock";
import { useOverlayDismiss } from "../hooks/useOverlayDismiss";
import { productImageSrc } from "../lib/assets";
import { formatPrice } from "../lib/format";
import styles from "./QuickViewModal.module.css";

interface QuickViewModalProps {
  product: Product | null;
  onClose: () => void;
}

interface SelectionState {
  productId: string;
  selectedColorHex: string;
  selectedSize: string;
  error: string;
}

export default function QuickViewModal({ product, onClose }: QuickViewModalProps) {
  const { addToCart, isCartMutating } = useCart();
  const [selection, setSelection] = useState<SelectionState | null>(null);
  useBodyScrollLock(Boolean(product));
  useOverlayDismiss(Boolean(product), onClose);

  const activeSelection = product && selection?.productId === product.id ? selection : null;

  // FE-006 / ADR-001 §3 & CAT-003: the option axes come from the product itself.
  // This modal used to render a fixed XS–XL list, which offered sizes that do
  // not exist in Medusa and resolved `variantId` to "" on add-to-cart. The
  // catalogue is ~90% ONE SIZE, so the fixed list was wrong for most items.
  const sizeValues =
    product?.options.find((option) => option.title === "Размер")?.values ??
    product?.availableSizes ??
    [];
  const colorValues = product?.options.find((option) => option.title === "Цвет")?.values ?? null;
  const colors = colorValues
    ? colorValues.map(
        (name) => product?.colors.find((color) => color.name === name) ?? { name, hex: "#808080" },
      )
    : product?.colors ?? [];

  // B3: a single size (typically "ONE SIZE") is not a choice — auto-select it,
  // show it as a static badge, and never demand "выберите размер".
  const isSingleSize = sizeValues.length === 1;
  const soleSize = sizeValues[0] ?? "";
  const requiresSizeChoice = sizeValues.length > 1;

  const defaultColor =
    colors.find((color) =>
      product?.variants.some(
        (variant) => variant.available && variant.options.Цвет === color.name,
      ),
    ) ??
    colors[0] ??
    null;

  const selectedColor =
    colors.find((color) => color.hex === activeSelection?.selectedColorHex) ?? defaultColor;
  const selectedSize = activeSelection?.selectedSize ?? (isSingleSize ? soleSize : "");
  const error = activeSelection?.error ?? "";

  // B1/B2 cross-availability: an option is offered only when an AVAILABLE
  // variant exists for it given the current choice on the opposite axis.
  // Non-existent and out-of-stock combinations both render disabled, not hidden.
  const isSizeAvailable = (size: string) =>
    Boolean(
      product?.variants.some(
        (variant) =>
          variant.available &&
          variant.options.Размер === size &&
          (!selectedColor || !colorValues || variant.options.Цвет === selectedColor.name),
      ),
    );

  const isColorAvailable = (colorName: string) =>
    Boolean(
      product?.variants.some(
        (variant) =>
          variant.available &&
          variant.options.Цвет === colorName &&
          (!selectedSize || sizeValues.length === 0 || variant.options.Размер === selectedSize),
      ),
    );

  // The variant must match only along axes this product actually has.
  const selectedVariant = product?.variants.find(
    (variant) =>
      variant.available &&
      (sizeValues.length === 0 || variant.options.Размер === selectedSize) &&
      (!colorValues || variant.options.Цвет === selectedColor?.name),
  );

  // B4: enabled only for a fully selected, existing, available combination.
  const canAddToCart = Boolean(selectedVariant) && !isCartMutating;

  // B3/B5: guidance only when a real size choice is pending and at least one
  // size can actually be picked — a sold-out product does not nudge.
  const sizeHint =
    requiresSizeChoice && !selectedSize && sizeValues.some(isSizeAvailable)
      ? "Выберите размер"
      : "";

  const updateSelection = (updates: Partial<Omit<SelectionState, "productId">>) => {
    if (!product) return;

    setSelection({
      productId: product.id,
      selectedColorHex: activeSelection?.selectedColorHex ?? selectedColor?.hex ?? "",
      selectedSize,
      error,
      ...updates,
    });
  };

  if (!product) return null;

  const handleAddToCart = () => {
    // Guarded by the disabled button (B4); this stays as a defensive no-op for
    // keyboard/programmatic activation. Critically, it no longer invents a
    // variantId: an unmatched selection cannot reach the cart at all.
    if (!selectedVariant || !selectedColor) return;

    updateSelection({ error: "" });
    addToCart({
      product,
      selectedSize,
      selectedColor,
      variantId: selectedVariant.variantId,
      quantity: 1,
    });

    // Close modal after adding
    onClose();
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
            src={productImageSrc(product.images)}
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
            {colors.length > 0 && (
              <div className={styles.colors}>
                <h3 className={styles.optionTitle}>Цвет: {selectedColor?.name}</h3>
                <div className={styles.colorList}>
                  {colors.map((color) => {
                    const isDisabled = !isColorAvailable(color.name);
                    return (
                      <button
                        key={color.name}
                        type="button"
                        className={`${styles.colorDot} ${
                          selectedColor?.hex === color.hex ? styles.colorDotActive : ""
                        } ${isDisabled ? styles.colorDotDisabled : ""}`}
                        style={{ backgroundColor: color.hex }}
                        onClick={() => {
                          if (isDisabled) return;
                          // Keep the selection coherent: drop a size that has no
                          // available variant in the newly chosen colour.
                          const keepSize =
                            isSingleSize ||
                            (selectedSize !== "" &&
                              product.variants.some(
                                (variant) =>
                                  variant.available &&
                                  variant.options.Цвет === color.name &&
                                  variant.options.Размер === selectedSize,
                              ));
                          updateSelection({
                            selectedColorHex: color.hex,
                            selectedSize: keepSize ? selectedSize : "",
                            error: "",
                          });
                        }}
                        disabled={isDisabled}
                        aria-disabled={isDisabled}
                        aria-label={`Выбрать цвет ${color.name}`}
                      />
                    );
                  })}
                </div>
              </div>
            )}

            {/* Sizes Selection — rendered only when the product has a size axis. */}
            {sizeValues.length > 0 && (
              <div className={styles.sizes}>
                <h3 className={styles.optionTitle}>Размер</h3>
                {requiresSizeChoice ? (
                  <div className={styles.sizeList}>
                    {sizeValues.map((size) => {
                      const isDisabled = !isSizeAvailable(size);
                      return (
                        <button
                          key={size}
                          type="button"
                          className={`${styles.sizeBtn} ${
                            selectedSize === size ? styles.sizeBtnActive : ""
                          } ${isDisabled ? styles.sizeBtnDisabled : ""}`}
                          onClick={() => {
                            if (isDisabled) return;
                            updateSelection({ selectedSize: size, error: "" });
                          }}
                          disabled={isDisabled}
                          aria-disabled={isDisabled}
                        >
                          {size}
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <span
                    className={styles.sizeBadge}
                    aria-label={`Единственный доступный размер: ${soleSize}`}
                  >
                    {soleSize}
                  </span>
                )}
                {sizeHint && <p className={styles.selectionHint}>{sizeHint}</p>}
                {error && <span className={styles.error}>{error}</span>}
              </div>
            )}
          </div>

          {/* Add to Cart Button */}
          <button
            type="button"
            className={styles.addToCartBtn}
            onClick={handleAddToCart}
            disabled={!canAddToCart}
            aria-busy={isCartMutating}
          >
            Добавить в корзину
          </button>
        </div>
      </div>
    </div>
  );
}
