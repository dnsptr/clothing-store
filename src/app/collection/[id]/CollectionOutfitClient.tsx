"use client";

import ProductCard from "../../../components/ProductCard";
import { useCatalog } from "../../../context/CatalogContext";
import type { Product } from "../../../data/mockData";
import styles from "./collection.module.css";

export default function CollectionOutfitClient({ products }: { products: Product[] }) {
  const { products: catalogProducts } = useCatalog();
  const currentProducts = products.map(
    (product) => catalogProducts.find((item) => item.id === product.id) ?? product,
  );

  return (
    <div className={styles.grid}>
      {currentProducts.map((product) => (
        <ProductCard key={product.id} product={product} headingLevel="h3" />
      ))}
    </div>
  );
}
