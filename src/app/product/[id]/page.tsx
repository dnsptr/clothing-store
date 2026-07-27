import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { Product } from "../../../data/mockData";
import { MOCK_PRODUCTS } from "../../../data/mockData";
import {
  CATALOG_REVALIDATE_SECONDS,
  fetchMedusaProductByHandle,
  isMedusaConfigured,
  storefrontDataMode,
} from "../../../lib/medusa";
import { formatPrice } from "../../../lib/format";
import ProductDetailClient from "./ProductDetailClient";
import Header from "../../../components/Header";
import Footer from "../../../components/Footer";
import styles from "./product.module.css";

interface ProductPageProps {
  params: Promise<{ id: string }>;
}

// Must be a literal: Next requires the segment value to be statically
// analysable. Keep in sync with CATALOG_REVALIDATE_SECONDS in lib/medusa.ts.
export const revalidate = 300;

const isPagesExport = process.env.BUILD_TARGET === "pages";

/**
 * Which product ids exist as prebuilt HTML.
 *
 * Static export target: the demo ships the mock catalog, exactly as before.
 *
 * Server target: an empty array on purpose. Per the Next 16 docs
 * (generate-static-params → "All paths at runtime"), returning `[]` is what
 * enables paths to be rendered on first request and then cached by ISR. This is
 * the fix for the roadmap's "самый дорогой скрытый дефект": previously the only
 * product pages that existed were the 12 mock ids, so a product created in
 * Medusa Admin had no page at all — not a slow page, no page.
 */
export async function generateStaticParams() {
  if (!isPagesExport) return [];
  return MOCK_PRODUCTS.map((product) => ({ id: product.id }));
}

/** The import convention mirrors the mock ids: `mario-mikke-<frontend id>`. */
const handleFor = (id: string) => `mario-mikke-${id}`;

type ProductResolution =
  | { status: "ok"; product: Product }
  | { status: "missing" }
  // ADR-001 §6 / FE-002: in medusa mode an unreachable API is a controlled error
  // state. It must never silently degrade into the demo catalog, and it must not
  // become a bare 500 either — the client renders the same unavailable UI it
  // already uses elsewhere.
  | { status: "error" };

async function resolveProduct(id: string): Promise<ProductResolution> {
  // Демо-каталог живёт ровно в одном режиме — mock. Раньше сюда попадал и
  // medusa-режим с потерянным ключом или URL, потому что условием была
  // `isMedusaConfigured`, ложная в обоих случаях. Из-за этого достаточно было
  // потерять переменную в окружении, чтобы боевые карточки начали отдавать
  // demo-товары с выдуманными ценами под HTTP 200 (ADR-001 §6).
  if (storefrontDataMode === "mock") {
    const mock = MOCK_PRODUCTS.find((product) => product.id === id);
    return mock ? { status: "ok", product: mock } : { status: "missing" };
  }

  if (!isMedusaConfigured) {
    // В production такая конфигурация не доживает до этой строки — витрина
    // падает при старте (см. lib/medusa.ts). В dev показываем то же
    // контролируемое состояние ошибки, что и при недоступной Medusa.
    console.error(
      "[PDP] DATA_MODE=medusa, но backend URL или publishable key не заданы.",
      { id },
    );
    return { status: "error" };
  }

  try {
    const product = await fetchMedusaProductByHandle(
      handleFor(id),
      undefined,
      CATALOG_REVALIDATE_SECONDS,
    );
    return product ? { status: "ok", product } : { status: "missing" };
  } catch (error) {
    console.error("[PDP] Medusa недоступна при серверном рендеринге товара.", {
      id,
      error,
    });
    return { status: "error" };
  }
}

export async function generateMetadata({ params }: ProductPageProps): Promise<Metadata> {
  const { id } = await params;
  const resolution = await resolveProduct(id);

  if (resolution.status !== "ok") {
    return { title: "Товар не найден | Mario Mikke" };
  }

  const { product } = resolution;
  const title = `${product.name} | Mario Mikke`;
  const description = `${product.name} — ${product.category}. ${formatPrice(product.price)}.`;

  return {
    title,
    description,
    alternates: { canonical: `/product/${product.id}` },
    openGraph: {
      title,
      description,
      type: "website",
      locale: "ru_RU",
      siteName: "Mario Mikke",
      ...(product.images[0] ? { images: [{ url: product.images[0] }] } : {}),
    },
  };
}

export default async function ProductDetailPage({ params }: ProductPageProps) {
  const { id } = await params;
  const resolution = await resolveProduct(id);

  // A genuinely absent product is a 404. An unreachable backend is not — that
  // would tell a shopper the item does not exist when it merely could not be
  // loaded, and would also poison the ISR cache with a 404 for a live product.
  if (resolution.status === "missing") {
    notFound();
  }

  return (
    <>
      <Header />

      <main className={styles.pageWrapper}>
        <div className={styles.shell}>
          <ProductDetailClient
            productId={id}
            initialProduct={resolution.status === "ok" ? resolution.product : null}
            serverError={resolution.status === "error"}
          />
        </div>
      </main>

      <Footer />
    </>
  );
}
