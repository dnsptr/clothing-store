"use client";

import { useCart } from "../context/CartContext";
import styles from "./CartErrorToast.module.css";

/**
 * Единственное место, где виден отказ операции с корзиной.
 *
 * Живёт в layout, а не в конкретной странице, потому что добавить, удалить или
 * изменить количество можно из шести разных мест — карточки товара, каталога,
 * быстрого просмотра, избранного, дровера и страницы корзины. Раньше отказ не
 * показывался нигде: промис игнорировался, и покупатель видел кнопку, которая
 * «не работает».
 */
export default function CartErrorToast() {
  const { cartError, dismissCartError } = useCart();

  if (!cartError) return null;

  return (
    <div className={styles.toast} role="alert" aria-live="assertive">
      <p className={styles.message}>{cartError}</p>
      <button
        type="button"
        className={styles.dismiss}
        onClick={dismissCartError}
        aria-label="Закрыть сообщение"
      >
        ×
      </button>
    </div>
  );
}
