import { notFound } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { MOCK_OUTFITS, MOCK_PRODUCTS } from "../../../data/mockData";
import CollectionOutfitClient from "./CollectionOutfitClient";
import Header from "../../../components/Header";
import Footer from "../../../components/Footer";
import styles from "./collection.module.css";

interface CollectionPageProps {
  params: Promise<{ id: string }>;
}

// Pre-render static paths for output: export config
export async function generateStaticParams() {
  return MOCK_OUTFITS.map((outfit) => ({
    id: outfit.id,
  }));
}

export default async function CollectionDetailPage({ params }: CollectionPageProps) {
  const { id } = await params;
  const outfit = MOCK_OUTFITS.find((o) => o.id === id);

  if (!outfit) {
    notFound();
  }

  // Filter products that are part of this outfit look
  const products = MOCK_PRODUCTS.filter((product) =>
    outfit.productIds.includes(product.id)
  );

  return (
    <div className={styles.pageWrapper}>
      <Header />

      {/* Campaign Fullscreen Banner Header */}
      <section className={styles.hero}>
        <div className={styles.imageWrapper}>
          <Image
            src={outfit.image}
            alt={outfit.title}
            fill
            priority
            className={styles.image}
          />
          <div className={styles.overlay} />
        </div>

        <div className={`${styles.heroContent} animate-fade-in`}>
          <span className={styles.heroSubtitle}>{outfit.subtitle}</span>
          <h1 className={styles.heroTitle}>{outfit.title}</h1>
        </div>
      </section>

      {/* Complete the Look Section */}
      <div className={styles.contentSection}>
        <div className={styles.shell}>
          {/* Breadcrumbs */}
          <div className={styles.breadcrumbs}>
            <Link href="/">Главная</Link>
            <span>/</span>
            <span>Кампания</span>
            <span>/</span>
            <span className={styles.breadcrumbCurrent}>{outfit.title}</span>
          </div>

          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>Составить образ</h2>
          </div>

          {/* Interactive Outfit items grid */}
          <CollectionOutfitClient products={products} />
        </div>
      </div>

      <Footer />
    </div>
  );
}
