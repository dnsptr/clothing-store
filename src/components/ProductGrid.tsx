"use client";

import Link from "next/link";
import { useCatalog } from "../context/CatalogContext";
import { CATALOG_SECTIONS } from "../lib/catalog";
import ProductCard from "./ProductCard";
import styles from "./ProductGrid.module.css";

export default function ProductGrid() {
  const { products, status, refetch } = useCatalog();
  const featured = products.slice(0, 4);

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

        {status === "loading" ? (
          <div
            className={styles.grid}
            role="status"
            aria-busy="true"
            aria-label="Загрузка новинок"
          >
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className={styles.skeletonCard} aria-hidden="true">
                <div className={styles.skeletonImage} />
                <div className={styles.skeletonLine} />
                <div className={`${styles.skeletonLine} ${styles.skeletonLineShort}`} />
              </div>
            ))}
          </div>
        ) : status === "error" ? (
          <div className={styles.stateMessage} role="alert">
            <p>Не удалось загрузить новинки.</p>
            <button type="button" className={styles.retryButton} onClick={refetch}>
              Повторить
            </button>
          </div>
        ) : featured.length === 0 ? (
          <div className={styles.stateMessage}>
            <p>Товары не найдены.</p>
          </div>
        ) : (
          <div className={styles.grid}>
            {featured.map((product) => (
              <ProductCard
                key={product.id}
                product={product}
                headingLevel="h3"
                imageSizes="(max-width: 768px) 50vw, (max-width: 1180px) 33vw, 25vw"
                variant="home"
              />
            ))}
          </div>
        )}
      </div>

    </section>
  );
}
