"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import Header from "../../components/Header";
import Footer from "../../components/Footer";
import ProductCard from "../../components/ProductCard";
import { MOCK_PRODUCTS } from "../../data/mockData";
import {
  CATALOG_PRIMARY_NAV,
  CLOTHING_SECTION_CATEGORIES,
  MATERIALS,
  getCatalogTitle,
  getMaterialBySlug,
} from "../../lib/catalog";
import styles from "./catalog.module.css";

function CatalogContent() {
  const searchParams = useSearchParams();
  const categoryParam = searchParams.get("category");
  const sectionParam = searchParams.get("section");
  const materialParam = searchParams.get("material");

  const [sortBy, setSortBy] = useState("default");

  const material = materialParam ? getMaterialBySlug(materialParam) : undefined;
  const filteredProducts = MOCK_PRODUCTS.filter((product) => {
    if (categoryParam) return product.category === categoryParam;
    if (material) return material.productIds.includes(product.id);
    if (sectionParam === "new") return Boolean(product.isNew);
    if (sectionParam === "clothing") return CLOTHING_SECTION_CATEGORIES.includes(product.category);
    if (sectionParam === "shoes") return product.category === "Обувь";
    if (sectionParam === "accessories") return product.category === "Аксессуары";
    if (sectionParam === "sale") return true;
    return true;
  }).sort((a, b) => {
    if (sortBy === "price-low-to-high") return a.price - b.price;
    if (sortBy === "price-high-to-low") return b.price - a.price;
    return 0;
  });

  const title = getCatalogTitle({
    category: categoryParam,
    material: materialParam,
    section: sectionParam,
  });

  const isCatalogLinkActive = (href: string) => {
    const [, queryString] = href.split("?");
    const params = new URLSearchParams(queryString);

    if (params.has("section")) return params.get("section") === sectionParam;
    if (params.has("material")) return params.get("material") === materialParam;
    if (params.has("category")) return params.get("category") === categoryParam;

    return !categoryParam && !sectionParam && !materialParam;
  };

  return (
    <>
      <Header />

      <main className={styles.page}>
        <div className={styles.shell}>
          <nav className={styles.breadcrumbs} aria-label="Хлебные крошки">
            <Link href="/">Главная</Link>
            <span>/</span>
            <span>{title}</span>
          </nav>

          <section className={styles.titleBlock}>
            <h1 className={styles.title}>{title}</h1>
          </section>
        </div>

        <div className={styles.filtersBand}>
          <div className={styles.shell}>
            <div className={styles.filtersRow}>
              <div className={styles.filters} aria-label="Разделы каталога">
                {CATALOG_PRIMARY_NAV.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`${styles.filterButton} ${
                      isCatalogLinkActive(item.href) ? styles.filterButtonActive : ""
                    }`}
                  >
                    {item.label}
                  </Link>
                ))}
                {MATERIALS.map((item) => (
                  <Link
                    key={item.slug}
                    href={item.href}
                    className={`${styles.filterButton} ${
                      isCatalogLinkActive(item.href) ? styles.filterButtonActive : ""
                    }`}
                  >
                    {item.label}
                  </Link>
                ))}
              </div>

              <label className={styles.sortControl}>
                <span className={styles.sortLabel}>Сортировка</span>
                <select
                  className={styles.sortSelect}
                  value={sortBy}
                  onChange={(event) => setSortBy(event.target.value)}
                  aria-label="Сортировка товаров"
                >
                  <option value="default">По умолчанию</option>
                  <option value="price-low-to-high">Цена: по возрастанию</option>
                  <option value="price-high-to-low">Цена: по убыванию</option>
                </select>
              </label>
            </div>
          </div>
        </div>

        <section className={styles.shell} aria-label="Товары">
          {filteredProducts.length === 0 ? (
            <div className={styles.emptyState}>
              <h2 className={styles.emptyTitle}>Категория пуста</h2>
              <p className={styles.emptyText}>
                Сейчас в этом разделе нет товаров. Вернитесь ко всему каталогу или выберите другую категорию.
              </p>
              <Link href="/catalog" className={styles.emptyLink}>
                Смотреть все
              </Link>
            </div>
          ) : (
            <div className={styles.grid}>
              {filteredProducts.map((product) => (
                <ProductCard key={product.id} product={product} />
              ))}
            </div>
          )}
        </section>
      </main>

      <Footer />
    </>
  );
}

export default function CatalogPage() {
  return (
    <Suspense fallback={<div className={styles.loading}>Загрузка каталога...</div>}>
      <CatalogContent />
    </Suspense>
  );
}
