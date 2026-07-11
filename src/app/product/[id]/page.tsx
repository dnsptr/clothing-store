import { notFound } from "next/navigation";
import Link from "next/link";
import { MOCK_PRODUCTS } from "../../../data/mockData";
import ProductDetailClient from "./ProductDetailClient";
import Header from "../../../components/Header";
import Footer from "../../../components/Footer";
import styles from "./product.module.css";

interface ProductPageProps {
  params: Promise<{ id: string }>;
}

// Pre-render static paths for output: export config
export async function generateStaticParams() {
  return MOCK_PRODUCTS.map((product) => ({
    id: product.id,
  }));
}

export default async function ProductDetailPage({ params }: ProductPageProps) {
  const { id } = await params;
  const product = MOCK_PRODUCTS.find((p) => p.id === id);

  if (!product) {
    notFound();
  }

  return (
    <>
      <Header />

      <main className={styles.pageWrapper}>
        <div className={styles.shell}>
          {/* Breadcrumbs */}
          <div className={styles.breadcrumbs}>
            <Link href="/">Главная</Link>
            <span>/</span>
            <span>Каталог</span>
            <span>/</span>
            <span>{product.name}</span>
          </div>

          <ProductDetailClient product={product} />
        </div>
      </main>

      <Footer />
    </>
  );
}
