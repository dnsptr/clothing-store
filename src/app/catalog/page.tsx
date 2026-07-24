"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import Header from "../../components/Header";
import Footer from "../../components/Footer";
import ProductCard from "../../components/ProductCard";
import { useCatalog } from "../../context/CatalogContext";
import {
  CATALOG_PRIMARY_NAV,
  CLOTHING_SECTION_CATEGORY_SLUGS,
  MATERIALS,
  getCatalogTitle,
  getCategoryBySlug,
  getMaterialBySlug,
} from "../../lib/catalog";
import styles from "./catalog.module.css";

const PRICE_FILTERS = [
  { value: "under-10000", label: "До 10 000" },
  { value: "10000-15000", label: "10 000-15 000" },
  { value: "from-15000", label: "От 15 000" },
];

const AVAILABILITY_FILTERS = [
  { value: "available", label: "В наличии" },
  { value: "sold-out", label: "Нет в наличии" },
];

function CatalogContent() {
  const { products, status, refetch } = useCatalog();
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
  const [openFacet, setOpenFacet] = useState<string | null>(null);
  const colorFilters = Array.from(
    new Map(
      products.flatMap((product) =>
        product.colors.map((color) => [color.name, color.name]),
      ),
    ).values(),
  );
  const sizeFilters = Array.from(
    new Set(products.flatMap((product) => product.availableSizes)),
  );

  const category = categoryParam ? getCategoryBySlug(categoryParam) : undefined;
  const material = materialParam ? getMaterialBySlug(materialParam) : undefined;
  const filteredProducts = products.filter((product) => {
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

  const clearCatalogParams = (keys: string[]) => {
    const nextParams = new URLSearchParams(searchParams.toString());
    keys.forEach((key) => nextParams.delete(key));

    const queryString = nextParams.toString();
    router.push(queryString ? `/catalog?${queryString}` : "/catalog", { scroll: false });
  };

  const applyFacetValue = (key: string, value: string) => {
    updateCatalogParam(key, value);
    setOpenFacet(null);
  };

  const getFacetButtonLabel = (label: string, value?: string | null, options?: { value: string; label: string }[]) => {
    if (!value) return label;
    return options?.find((option) => option.value === value)?.label ?? value;
  };

  const activeFilterChips = [
    sizeParam ? { key: "size", label: `Размер: ${sizeParam}` } : null,
    colorParam ? { key: "color", label: `Цвет: ${colorParam}` } : null,
    priceParam
      ? {
          key: "price",
          label: `Цена: ${getFacetButtonLabel("Цена", priceParam, PRICE_FILTERS)}`,
        }
      : null,
    availabilityParam
      ? {
          key: "availability",
          label: getFacetButtonLabel("Наличие", availabilityParam, AVAILABILITY_FILTERS),
        }
      : null,
  ].filter((chip): chip is { key: string; label: string } => Boolean(chip));

  const hasActiveFilters = activeFilterChips.length > 0;

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
                <div className={styles.facet}>
                  <button
                    type="button"
                    className={`${styles.facetButton} ${sizeParam ? styles.facetButtonActive : ""}`}
                    onClick={() => setOpenFacet(openFacet === "size" ? null : "size")}
                    aria-expanded={openFacet === "size"}
                  >
                    {getFacetButtonLabel("Размер", sizeParam)}
                    <span className={styles.facetChevron} aria-hidden="true" />
                  </button>
                  {openFacet === "size" && (
                    <div className={styles.facetPanel}>
                      <button type="button" className={styles.facetOption} onClick={() => applyFacetValue("size", "")}>
                        Все размеры
                      </button>
                      {sizeFilters.map((size) => (
                        <button
                          key={size}
                          type="button"
                          className={`${styles.facetOption} ${sizeParam === size ? styles.facetOptionActive : ""}`}
                          onClick={() => applyFacetValue("size", size)}
                        >
                          {size}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div className={styles.facet}>
                  <button
                    type="button"
                    className={`${styles.facetButton} ${colorParam ? styles.facetButtonActive : ""}`}
                    onClick={() => setOpenFacet(openFacet === "color" ? null : "color")}
                    aria-expanded={openFacet === "color"}
                  >
                    {getFacetButtonLabel("Цвет", colorParam)}
                    <span className={styles.facetChevron} aria-hidden="true" />
                  </button>
                  {openFacet === "color" && (
                    <div className={styles.facetPanel}>
                      <button type="button" className={styles.facetOption} onClick={() => applyFacetValue("color", "")}>
                        Все цвета
                      </button>
                      {colorFilters.map((color) => (
                        <button
                          key={color}
                          type="button"
                          className={`${styles.facetOption} ${colorParam === color ? styles.facetOptionActive : ""}`}
                          onClick={() => applyFacetValue("color", color)}
                        >
                          {color}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div className={styles.facet}>
                  <button
                    type="button"
                    className={`${styles.facetButton} ${priceParam ? styles.facetButtonActive : ""}`}
                    onClick={() => setOpenFacet(openFacet === "price" ? null : "price")}
                    aria-expanded={openFacet === "price"}
                  >
                    {getFacetButtonLabel("Цена", priceParam, PRICE_FILTERS)}
                    <span className={styles.facetChevron} aria-hidden="true" />
                  </button>
                  {openFacet === "price" && (
                    <div className={styles.facetPanel}>
                      <button type="button" className={styles.facetOption} onClick={() => applyFacetValue("price", "")}>
                        Любая цена
                      </button>
                      {PRICE_FILTERS.map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          className={`${styles.facetOption} ${priceParam === option.value ? styles.facetOptionActive : ""}`}
                          onClick={() => applyFacetValue("price", option.value)}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div className={styles.facet}>
                  <button
                    type="button"
                    className={`${styles.facetButton} ${availabilityParam ? styles.facetButtonActive : ""}`}
                    onClick={() => setOpenFacet(openFacet === "availability" ? null : "availability")}
                    aria-expanded={openFacet === "availability"}
                  >
                    {getFacetButtonLabel("Наличие", availabilityParam, AVAILABILITY_FILTERS)}
                    <span className={styles.facetChevron} aria-hidden="true" />
                  </button>
                  {openFacet === "availability" && (
                    <div className={styles.facetPanel}>
                      <button type="button" className={styles.facetOption} onClick={() => applyFacetValue("availability", "")}>
                        Все товары
                      </button>
                      {AVAILABILITY_FILTERS.map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          className={`${styles.facetOption} ${availabilityParam === option.value ? styles.facetOptionActive : ""}`}
                          onClick={() => applyFacetValue("availability", option.value)}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
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
          {status === "loading" ? (
            <div
              className={styles.grid}
              role="status"
              aria-busy="true"
              aria-label="Загрузка товаров"
            >
              {Array.from({ length: 8 }).map((_, index) => (
                <div key={index} className={styles.skeletonCard} aria-hidden="true">
                  <div className={styles.skeletonImage} />
                  <div className={styles.skeletonLine} />
                  <div className={`${styles.skeletonLine} ${styles.skeletonLineShort}`} />
                </div>
              ))}
            </div>
          ) : status === "error" ? (
            <div className={styles.emptyState} role="alert">
              <h2 className={styles.emptyTitle}>Каталог временно недоступен</h2>
              <p className={styles.emptyText}>
                Не удалось загрузить товары. Проверьте подключение и попробуйте ещё раз.
              </p>
              <button type="button" className={styles.retryButton} onClick={refetch}>
                Повторить
              </button>
            </div>
          ) : products.length === 0 ? (
            <div className={styles.emptyState}>
              <h2 className={styles.emptyTitle}>Товары не найдены</h2>
              <p className={styles.emptyText}>
                В каталоге пока нет товаров. Загляните позже — мы обновляем ассортимент.
              </p>
            </div>
          ) : (
            <>
              {hasActiveFilters && (
                <div className={styles.activeFilters} aria-label="Активные фильтры">
                  {activeFilterChips.map((chip) => (
                    <button
                      key={chip.key}
                      type="button"
                      className={styles.filterChip}
                      onClick={() => clearCatalogParams([chip.key])}
                    >
                      {chip.label}
                      <span aria-hidden="true">×</span>
                    </button>
                  ))}
                  <button
                    type="button"
                    className={styles.clearFilters}
                    onClick={() => clearCatalogParams(["size", "color", "price", "availability"])}
                  >
                    Сбросить фильтры
                  </button>
                </div>
              )}

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
            </>
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
