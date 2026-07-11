import Link from "next/link";
import { MOCK_PRODUCTS } from "../data/mockData";
import { CATALOG_SECTIONS } from "../lib/catalog";
import ProductCard from "./ProductCard";
import styles from "./ProductGrid.module.css";

export default function ProductGrid() {
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

        <div className={styles.grid}>
          {MOCK_PRODUCTS.slice(0, 4).map((product) => (
            <ProductCard
              key={product.id}
              product={product}
              headingLevel="h3"
              imageSizes="(max-width: 768px) 50vw, (max-width: 1180px) 33vw, 25vw"
              variant="home"
            />
          ))}
        </div>
      </div>

    </section>
  );
}
