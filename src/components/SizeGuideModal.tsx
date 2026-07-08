"use client";

import { useEffect } from "react";
import styles from "./SizeGuideModal.module.css";

interface SizeGuideModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function SizeGuideModal({ isOpen, onClose }: SizeGuideModalProps) {
  // Close size guide modal on ESC key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className={`${styles.overlay} ${isOpen ? styles.overlayOpen : ""}`}
      onClick={onClose}
    >
      <div
        className={styles.modal}
        onClick={(e) => e.stopPropagation()} // Prevent close on modal click
      >
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

        <h2 className={styles.title}>Таблица размеров</h2>

        <div className={styles.tableWrapper}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Размер</th>
                <th>Обхват груди</th>
                <th>Обхват талии</th>
                <th>Обхват бедер</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>XS (RU 40-42)</td>
                <td>80–84 см</td>
                <td>60–64 см</td>
                <td>86–90 см</td>
              </tr>
              <tr>
                <td>S (RU 42-44)</td>
                <td>84–88 см</td>
                <td>64–68 см</td>
                <td>90–94 см</td>
              </tr>
              <tr>
                <td>M (RU 44-46)</td>
                <td>88–92 см</td>
                <td>68–72 см</td>
                <td>94–98 см</td>
              </tr>
              <tr>
                <td>L (RU 46-48)</td>
                <td>92–96 см</td>
                <td>72–76 см</td>
                <td>98–102 см</td>
              </tr>
              <tr>
                <td>XL (RU 48-50)</td>
                <td>96–100 см</td>
                <td>76–80 см</td>
                <td>102–106 см</td>
              </tr>
            </tbody>
          </table>
        </div>

        <p className={styles.note}>
          * Данная таблица представляет стандартные параметры изделий. Посадка может отличаться в зависимости от кроя (оверсайз, прямой или приталенный силуэт).
        </p>
      </div>
    </div>
  );
}
