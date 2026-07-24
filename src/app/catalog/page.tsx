"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import Header from "../../components/Header";
import Footer from "../../components/Footer";
import ProductCard from "../../components/ProductCard";
import type { Product } from "../../data/mockData";
import { useCatalog } from "../../context/CatalogContext";
import { fetchMedusaCategories, fetchMedusaProducts } from "../../lib/medusa";
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

// FE-004 A3: products fetched per page in medusa mode.
const CATALOG_PAGE_SIZE = 24;

function CatalogContent() {
  const {
    products: contextProducts,
    source,
    status: contextStatus,
    refetch: contextRefetch,
  } = useCatalog();
  const isMedusa = source === "medusa";
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

  // --- FE-004 A3/A5: catalog data source -----------------------------------
  // Mock mode keeps the previous behaviour: the global context holds the full
  // mock list and every filter runs client-side. Medusa mode instead fetches the
  // catalog a page at a time with its OWN request (independent of the global
  // context), filters categories server-side, and reveals more via "Показать
  // ещё" until Medusa's reported count is exhausted.
  const [categoryMap, setCategoryMap] = useState<Map<string, string> | null>(null);
  const [pageData, setPageData] = useState<{ key: string; products: Product[]; count: number } | null>(null);
  const [pageErrorKey, setPageErrorKey] = useState<string | null>(null);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const loadMoreAbortRef = useRef<AbortController | null>(null);

  // Slug (== Medusa category handle) → id, resolved for server-side filtering.
  const categoryId = categoryParam ? categoryMap?.get(categoryParam) : undefined;
  const queryKey = categoryParam ?? "__all__";
  const categoriesReady = categoryMap !== null;
  const hasPageForKey = pageData?.key === queryKey;
  const pageErroredForKey = pageErrorKey === queryKey;

  // Load categories once (medusa only), cached in state for slug→id mapping.
  useEffect(() => {
    if (!isMedusa) return;
    const controller = new AbortController();
    fetchMedusaCategories(controller.signal)
      .then((categories) => {
        if (controller.signal.aborted) return;
        setCategoryMap(
          new Map(categories.map((category): [string, string] => [category.handle, category.id])),
        );
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        if (error instanceof DOMException && error.name === "AbortError") return;
        console.error("Не удалось загрузить категории каталога.", error);
        // Empty map = degrade to client-side category filtering over loaded pages.
        setCategoryMap(new Map());
      });
    return () => controller.abort();
  }, [isMedusa]);

  // Load the first page whenever the selected category changes. Loading/error are
  // DERIVED below from whether pageData matches queryKey, so this effect never
  // sets state synchronously (keeps react-hooks/set-state-in-effect satisfied).
  useEffect(() => {
    if (!isMedusa) return;
    if (categoryParam && !categoriesReady) return; // wait for the slug→id map
    if (hasPageForKey || pageErroredForKey) return;

    const controller = new AbortController();
    fetchMedusaProducts({ limit: CATALOG_PAGE_SIZE, offset: 0, categoryId }, controller.signal)
      .then((page) => {
        if (controller.signal.aborted) return;
        setPageData({ key: queryKey, products: page.products, count: page.count });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        if (error instanceof DOMException && error.name === "AbortError") return;
        console.error("Не удалось загрузить страницу каталога.", error);
        setPageErrorKey(queryKey);
      });
    return () => controller.abort();
  }, [isMedusa, categoryParam, categoriesReady, hasPageForKey, pageErroredForKey, categoryId, queryKey]);

  // Abort any in-flight "load more" on unmount.
  useEffect(() => () => loadMoreAbortRef.current?.abort(), []);

  const handleLoadMore = () => {
    if (!isMedusa || !pageData || isLoadingMore) return;
    if (pageData.products.length >= pageData.count) return;

    loadMoreAbortRef.current?.abort();
    const controller = new AbortController();
    loadMoreAbortRef.current = controller;
    const keyAtRequest = pageData.key;
    const offset = pageData.products.length;

    setIsLoadingMore(true);
    fetchMedusaProducts({ limit: CATALOG_PAGE_SIZE, offset, categoryId }, controller.signal)
      .then((page) => {
        if (controller.signal.aborted) return;
        setPageData((previous) => {
          // Ignore the response if the category changed while it was in flight.
          if (!previous || previous.key !== keyAtRequest) return previous;
          const seen = new Set(previous.products.map((item) => item.id));
          const merged = [
            ...previous.products,
            ...page.products.filter((item) => !seen.has(item.id)),
          ];
          return { key: previous.key, products: merged, count: page.count };
        });
        setIsLoadingMore(false);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        if (error instanceof DOMException && error.name === "AbortError") return;
        console.error("Не удалось загрузить ещё товары.", error);
        setIsLoadingMore(false);
      });
  };

  const retry = () => {
    if (isMedusa) {
      // Clearing the error for this key lets the first-page effect refetch.
      setPageErrorKey((previous) => (previous === queryKey ? null : previous));
      return;
    }
    contextRefetch();
  };

  // Unified view over the two data sources.
  const medusaPage = hasPageForKey ? pageData : null;
  const products = isMedusa ? medusaPage?.products ?? [] : contextProducts;
  const status: "error" | "loading" | "ready" = isMedusa
    ? pageErroredForKey
      ? "error"
      : medusaPage
        ? "ready"
        : "loading"
    : contextStatus;
  const hasMore = Boolean(isMedusa && medusaPage && medusaPage.products.length < medusaPage.count);
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
  // FE-004 A3 — KNOWN LIMITATION: in medusa mode only the category tab is applied
  // server-side (via category_id). Every filter below — the section/material
  // narrowing here and the size/color/price/availability facets in the next
  // .filter() — runs CLIENT-SIDE over the products already loaded into the page.
  // With today's catalog (12 products, a single page of 24) this is exact; once
  // the catalog grows beyond one page these would need to move server-side.
  const filteredProducts = products.filter((product) => {
    if (categoryParam) {
      // Server already narrowed by category id — accept the loaded page as-is.
      if (isMedusa && categoryId) return true;
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
              <button type="button" className={styles.retryButton} onClick={retry}>
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

              {/* FE-004 A3: paginate the medusa catalog until count is exhausted.
                  Compact indicator while the next page loads; button otherwise. */}
              {isMedusa && (hasMore || isLoadingMore) && (
                <div className={styles.loadMore}>
                  {isLoadingMore ? (
                    <span className={styles.loadMoreStatus} role="status" aria-live="polite">
                      Загрузка…
                    </span>
                  ) : (
                    <button type="button" className={styles.loadMoreButton} onClick={handleLoadMore}>
                      Показать ещё
                    </button>
                  )}
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
