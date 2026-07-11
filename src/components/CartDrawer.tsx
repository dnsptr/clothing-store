"use client";

import { useRef } from "react";
import Link from "next/link";
import Image from "next/image";
import { useCart } from "../context/CartContext";
import { useBodyScrollLock } from "../hooks/useBodyScrollLock";
import { useOverlayDismiss } from "../hooks/useOverlayDismiss";
import { formatPrice } from "../lib/format";
import styles from "./CartDrawer.module.css";

export default function CartDrawer() {
  const {
    cartItems,
    isCartOpen,
    toggleCart,
    removeFromCart,
    updateQuantity,
    cartTotal,
    cartCount,
    setIsCartOpen,
  } = useCart();

  const drawerRef = useRef<HTMLDivElement>(null);
  useBodyScrollLock(isCartOpen);
  useOverlayDismiss(isCartOpen, () => setIsCartOpen(false));

  return (
    <>
      {/* Backdrop overlay */}
      <div
        className={`${styles.overlay} ${isCartOpen ? styles.overlayOpen : ""}`}
        onClick={toggleCart}
      />

      {/* Slide-out Drawer container */}
      <div
        ref={drawerRef}
        className={`${styles.drawer} ${isCartOpen ? styles.drawerOpen : ""}`}
        aria-hidden={!isCartOpen}
      >
        {/* Drawer Header */}
        <div className={styles.header}>
          <h2 className={styles.title}>Корзина ({cartCount})</h2>
          <button className={styles.closeBtn} onClick={toggleCart} aria-label="Закрыть корзину">
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
        </div>

        {/* Drawer Body */}
        <div className={styles.body}>
          {cartItems.length === 0 ? (
            <div className={styles.emptyState}>
              <svg
                className={styles.emptyIcon}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="1.5"
                  d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z"
                />
              </svg>
              <p className={styles.emptyText}>Ваша корзина пуста</p>
              <button className={styles.continueShopping} onClick={toggleCart}>
                Вернуться к покупкам
              </button>
            </div>
          ) : (
            cartItems.map((item, index) => (
              <div
                key={`${item.product.id}-${item.selectedSize}-${item.selectedColor.hex}-${index}`}
                className={styles.item}
              >
                {/* Product Thumbnail */}
                <div className={styles.imageWrapper}>
                  <Image
                    src={item.product.images[0]}
                    alt={item.product.name}
                    fill
                    sizes="80px"
                    className={styles.itemImage}
                  />
                </div>

                {/* Details & Actions */}
                <div className={styles.itemDetails}>
                  <div>
                    <div className={styles.itemHeader}>
                      <h3 className={styles.itemName}>{item.product.name}</h3>
                      <button
                        className={styles.itemRemove}
                        onClick={() =>
                          removeFromCart(item.product.id, item.selectedSize, item.selectedColor.hex)
                        }
                        aria-label="Удалить товар"
                      >
                        Удалить
                      </button>
                    </div>

                    <div className={styles.itemMeta}>
                      <span>Размер: {item.selectedSize}</span>
                      <div className={styles.colorIndicator}>
                        <span>Цвет:</span>
                        <span
                          className={styles.colorCircle}
                          style={{ backgroundColor: item.selectedColor.hex }}
                          title={item.selectedColor.name}
                        />
                      </div>
                    </div>
                  </div>

                  <div className={styles.itemFooter}>
                    {/* Quantity Selector */}
                    <div className={styles.qtyControls}>
                      <button
                        className={styles.qtyBtn}
                        onClick={() =>
                          updateQuantity(
                            item.product.id,
                            item.selectedSize,
                            item.selectedColor.hex,
                            item.quantity - 1
                          )
                        }
                        aria-label="Уменьшить количество"
                      >
                        &minus;
                      </button>
                      <span className={styles.qtyValue}>{item.quantity}</span>
                      <button
                        className={styles.qtyBtn}
                        onClick={() =>
                          updateQuantity(
                            item.product.id,
                            item.selectedSize,
                            item.selectedColor.hex,
                            item.quantity + 1
                          )
                        }
                        aria-label="Увеличить количество"
                      >
                        +
                      </button>
                    </div>

                    {/* Total Price for this item line */}
                    <span className={styles.itemPrice}>
                      {formatPrice(item.product.price * item.quantity)}
                    </span>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Drawer Footer */}
        {cartItems.length > 0 && (
          <div className={styles.footer}>
            <div className={styles.summaryRow}>
              <span className={styles.summaryLabel}>Итого</span>
              <span className={styles.summaryValue}>{formatPrice(cartTotal)}</span>
            </div>
            <Link
              href="/checkout"
              className={styles.checkoutBtn}
              onClick={() => setIsCartOpen(false)}
            >
              Оформить заказ
            </Link>
          </div>
        )}
      </div>
    </>
  );
}
