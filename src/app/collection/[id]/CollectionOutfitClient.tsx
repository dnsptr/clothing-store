import ProductCard from "../../../components/ProductCard";
import type { Product } from "../../../data/mockData";
import styles from "./collection.module.css";

export default function CollectionOutfitClient({ products }: { products: Product[] }) {
  return (
    <div className={styles.grid}>
      {products.map((product) => (
        <ProductCard key={product.id} product={product} headingLevel="h3" />
      ))}
    </div>
  );
}
