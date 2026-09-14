import { notFound, unstable_rethrow } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { MOCK_OUTFITS, MOCK_PRODUCTS, type Product } from "../../../data/mockData";
import { withBasePath } from "../../../lib/assets";
import {
  CATALOG_REVALIDATE_SECONDS,
  fetchMedusaProductsByHandles,
  isMedusaConfigured,
  storefrontDataMode,
} from "../../../lib/medusa";
import CollectionOutfitClient from "./CollectionOutfitClient";
import Header from "../../../components/Header";
import Footer from "../../../components/Footer";
import styles from "./collection.module.css";

interface CollectionPageProps {
  params: Promise<{ id: string }>;
}

// Сам образ (заголовок, подпись, баннер) — редакционный контент, которого в
// Medusa пока нет: управление главной и коллекциями из админки вынесено в
// отдельную задачу. Поэтому список образов остаётся статическим в обоих
// режимах — в отличие от товаров внутри образа, у которых есть цена и наличие.
export async function generateStaticParams() {
  return MOCK_OUTFITS.map((outfit) => ({
    id: outfit.id,
  }));
}

/** Соглашение импорта повторяет mock-идентификаторы: `mario-mikke-<frontend id>`. */
const handleFor = (id: string) => `mario-mikke-${id}`;

type OutfitProducts =
  | { status: "ok"; products: Product[] }
  // Товары образа не удалось загрузить. Показать вместо них demo-позиции нельзя
  // (ADR-001 §6): у них своя цена и своё наличие, и покупатель принял бы их за
  // настоящие.
  | { status: "error" };

async function resolveOutfitProducts(productIds: string[]): Promise<OutfitProducts> {
  if (storefrontDataMode === "mock") {
    return {
      status: "ok",
      products: MOCK_PRODUCTS.filter((product) => productIds.includes(product.id)),
    };
  }

  if (!isMedusaConfigured) {
    console.error("[Collection] DATA_MODE=medusa, но backend URL или publishable key не заданы.");
    return { status: "error" };
  }

  try {
    return {
      status: "ok",
      products: await fetchMedusaProductsByHandles(
        productIds.map(handleFor),
        CATALOG_REVALIDATE_SECONDS,
      ),
    };
  } catch (error) {
    unstable_rethrow(error);
    console.error("[Collection] Medusa недоступна при серверном рендеринге образа.", {
      productIds,
      error,
    });
    return { status: "error" };
  }
}

export default async function CollectionDetailPage({ params }: CollectionPageProps) {
  const { id } = await params;
  const outfit = MOCK_OUTFITS.find((o) => o.id === id);

  if (!outfit) {
    notFound();
  }

  const outfitProducts = await resolveOutfitProducts(outfit.productIds);

  return (
    <div className={styles.pageWrapper}>
      <Header />

      {/* Campaign Fullscreen Banner Header */}
      <section className={styles.hero}>
        <div className={styles.imageWrapper}>
          <Image
            src={withBasePath(outfit.image)}
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
          {outfitProducts.status === "ok" ? (
            <CollectionOutfitClient products={outfitProducts.products} />
          ) : (
            <p className={styles.outfitUnavailable} role="alert">
              Не удалось загрузить товары образа. Обновите страницу или загляните
              в <Link href="/catalog">каталог</Link>.
            </p>
          )}
        </div>
      </div>

      <Footer />
    </div>
  );
}
