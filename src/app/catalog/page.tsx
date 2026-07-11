"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import Header from "../../components/Header";
import Footer from "../../components/Footer";
import ProductCard from "../../components/ProductCard";
import { MOCK_PRODUCTS } from "../../data/mockData";
import {
  CATALOG_PRIMARY_NAV,
  CLOTHING_SECTION_CATEGORY_SLUGS,
  MATERIALS,
  getCatalogTitle,
  getCategoryBySlug,
  getMaterialBySlug,
} from "../../lib/catalog";
import { AVAILABLE_SIZES } from "../../lib/shop";
import styles from "./catalog.module.css";

const COLOR_FILTERS = Array.from(
  new Map(
    MOCK_PRODUCTS.flatMap((product) =>
      product.colors.map((color) => [color.name, color.name])
    )
  ).values()
);

function CatalogContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const categoryParam = searchParams.get("category");
  const sectionParam = searchParams.get("section");
  const materialParam = searchParams.get("material");
  const sizeParam = searchParams.get("size");
  const colorParam = searchParams.get("color");
  const priceParam = searchParams.get("price");
  const availabilityParam = searchParams.get("availability");

  const [sortBy, setSortBy] = useState("default");

  const category = categoryParam ? getCategoryBySlug(categoryParam) : undefined;
  const material = materialParam ? getMaterialBySlug(materialParam) : undefined;
  const filteredProducts = MOCK_PRODUCTS.filter((product) => {
    if (categoryParam) {
      return category
        ? product.categorySlug === category.slug
        : product.category === categoryParam;
    }
    if (material) return product.materialSlugs.includes(material.slug);
    if (sectionParam === "new") return Boolean(product.isNew);
    if (sectionParam === "clothing") return CLOTHING_SECTION_CATEGORY_SLUGS.includes(product.categorySlug);
    if (sectionParam === "shoes") return product.categorySlug === "shoes";
    if (sectionParam === "accessories") return product.categorySlug === "accessories";
    if (sectionParam === "sale") return true;
    return true;
  }).filter((product) => {
    if (sizeParam && !product.availableSizes.includes(sizeParam)) return false;
    if (colorParam && !product.colors.some((color) => color.name === colorParam)) return false;
    if (priceParam === "under-10000" && product.price >= 10000) return false;
    if (priceParam === "10000-15000" && (product.price < 10000 || product.price > 15000)) return false;
    if (priceParam === "from-15000" && product.price < 15000) return false;
    if (availabilityParam === "available" && product.isSoldOut) return false;
    if (availabilityParam === "sold-out" && !product.isSoldOut) return false;

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

  const updateCatalogParam = (key: string, value: string) => {
    const nextParams = new URLSearchParams(searchParams.toString());

    if (value) {
      nextParams.set(key, value);
    } else {
      nextParams.delete(key);
    }

    const queryString = nextParams.toString();
    router.push(queryString ? `/catalog?${queryString}` : "/catalog", { scroll: false });
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

              <div className={styles.facetControls} aria-label="Фильтры товаров">
                <select
                  className={styles.facetSelect}
                  value={sizeParam ?? ""}
                  onChange={(event) => updateCatalogParam("size", event.target.value)}
                  aria-label="Размер"
                >
                  <option value="">Размер</option>
                  {AVAILABLE_SIZES.map((size) => (
                    <option key={size} value={size}>
                      {size}
                    </option>
                  ))}
                </select>
                <select
                  className={styles.facetSelect}
                  value={colorParam ?? ""}
                  onChange={(event) => updateCatalogParam("color", event.target.value)}
                  aria-label="Цвет"
                >
                  <option value="">Цвет</option>
                  {COLOR_FILTERS.map((color) => (
                    <option key={color} value={color}>
                      {color}
                    </option>
                  ))}
                </select>
                <select
                  className={styles.facetSelect}
                  value={priceParam ?? ""}
                  onChange={(event) => updateCatalogParam("price", event.target.value)}
                  aria-label="Цена"
                >
                  <option value="">Цена</option>
                  <option value="under-10000">До 10 000</option>
                  <option value="10000-15000">10 000-15 000</option>
                  <option value="from-15000">От 15 000</option>
                </select>
                <select
                  className={styles.facetSelect}
                  value={availabilityParam ?? ""}
                  onChange={(event) => updateCatalogParam("availability", event.target.value)}
                  aria-label="Наличие"
                >
                  <option value="">Наличие</option>
                  <option value="available">В наличии</option>
                  <option value="sold-out">Нет в наличии</option>
                </select>
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
