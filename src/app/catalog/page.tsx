"use client";

import { Suspense, useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import Header from "../../components/Header";
import Footer from "../../components/Footer";
import QuickViewModal from "../../components/QuickViewModal";
import { MOCK_PRODUCTS, Product } from "../../data/mockData";
import styles from "./catalog.module.css";
import productStyles from "../../components/ProductGrid.module.css";

function CatalogContent() {
  const searchParams = useSearchParams();
  const categoryParam = searchParams.get("category");

  const [filteredProducts, setFilteredProducts] = useState<Product[]>([]);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [activeColors, setActiveColors] = useState<Record<string, number>>({});
  const [sortBy, setSortBy] = useState<string>("default");

  // Filter and sort items whenever params or sort key change
  useEffect(() => {
    let result = MOCK_PRODUCTS.filter((product) => {
      // Filter by category if parameter is present
      const matchesCategory =
        !categoryParam || product.category === categoryParam;

      return matchesCategory;
    });

    // Apply sorting logic
    if (sortBy === "price-low-to-high") {
      result.sort((a, b) => a.price - b.price);
    } else if (sortBy === "price-high-to-low") {
      result.sort((a, b) => b.price - a.price);
    }

    setFilteredProducts(result);
  }, [categoryParam, sortBy]);

  const handleColorSelect = (productId: string, colorIndex: number) => {
    setActiveColors((prev) => ({
      ...prev,
      [productId]: colorIndex,
    }));
  };

  const formatPrice = (price: number) => {
    return price.toLocaleString("ru-RU") + " ₽";
  };

  const getPageTitle = () => {
    if (categoryParam) return categoryParam;
    return "Коллекция";
  };

  return (
    <>
      <Header />

      <div className={styles.pageWrapper}>
        <div className="container animate-fade-in">
          {/* Breadcrumbs */}
          <div className={styles.breadcrumbs}>
            <Link href="/">Главная</Link>
            <span>/</span>
            <span style={{ color: "var(--text-primary)" }}>Каталог</span>
            {categoryParam && (
              <>
                <span>/</span>
                <span style={{ color: "var(--text-primary)" }}>{categoryParam}</span>
              </>
            )}
          </div>

          {/* Top Bar (Title & Sorting) */}
          <div className={styles.topBar}>
            <div className={styles.titleSection}>
              <h1 className={styles.categoryTitle}>{getPageTitle()}</h1>
              <span className={styles.itemCount}>
                Найдено: {filteredProducts.length}
              </span>
            </div>

            <div className={styles.controls}>
              <select
                className={styles.sortSelect}
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                aria-label="Сортировка товаров"
              >
                <option value="default">По умолчанию</option>
                <option value="price-low-to-high">Цена: по возрастанию</option>
                <option value="price-high-to-low">Цена: по убыванию</option>
              </select>
            </div>
          </div>

          {/* Catalog Grid */}
          {filteredProducts.length === 0 ? (
            <div className={styles.emptyState}>
              <svg
                className={styles.emptyIcon}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="1.5"
                  d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"
                />
              </svg>
              <h3 className={styles.emptyTitle}>Категория пуста</h3>
              <p className={styles.emptyText}>
                В данный момент товары в этой категории отсутствуют. Пожалуйста, вернитесь позже или выберите другой раздел.
              </p>
              <Link href="/" className={styles.backHomeBtn}>
                На главную
              </Link>
            </div>
          ) : (
            <div className={styles.grid}>
              {filteredProducts.map((product) => {
                const activeIndex = activeColors[product.id] ?? 0;
                return (
                  <div key={product.id} className={productStyles.card}>
                    {/* Image Container */}
                    <div
                      className={productStyles.imageContainer}
                      onClick={() => setSelectedProduct(product)}
                    >
                      {product.isNew && <span className={productStyles.badge}>New</span>}
                      
                      {/* Wishlist Button */}
                      <button
                        className={productStyles.wishlistBtn}
                        onClick={(e) => {
                          e.stopPropagation();
                          alert("Добавлено в избранное");
                        }}
                        aria-label="Добавить в избранное"
                      >
                        <svg
                          className={productStyles.wishlistIcon}
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth="1.5"
                            d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"
                          />
                        </svg>
                      </button>

                      <Image
                        src={product.images[0]}
                        alt={product.name}
                        fill
                        sizes="(max-width: 768px) 50vw, (max-width: 1024px) 33vw, 25vw"
                        className={productStyles.image}
                      />

                      {/* Hover Quick Add */}
                      <div className={productStyles.quickAdd}>Быстрый просмотр</div>
                    </div>

                    {/* Info Section */}
                    <div className={productStyles.info}>
                      <span className={productStyles.category}>{product.category}</span>
                      <h3 className={productStyles.name} title={product.name}>
                        <Link href={`/product/${product.id}`} style={{ display: "block" }}>
                          {product.name}
                        </Link>
                      </h3>
                      <span className={productStyles.price}>{formatPrice(product.price)}</span>

                      {/* Colors Selector */}
                      {product.colors && product.colors.length > 0 && (
                        <div className={productStyles.colors}>
                          {product.colors.map((color, index) => (
                            <button
                              key={color.name}
                              className={`${productStyles.colorDot} ${
                                activeIndex === index ? productStyles.colorDotActive : ""
                              }`}
                              style={{ backgroundColor: color.hex }}
                              title={color.name}
                              onClick={() => handleColorSelect(product.id, index)}
                              aria-label={`Выбрать цвет ${color.name}`}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <Footer />

      {/* Render Quick View Modal */}
      <QuickViewModal
        product={selectedProduct}
        onClose={() => setSelectedProduct(null)}
      />
    </>
  );
}

export default function CatalogPage() {
  return (
    <Suspense fallback={<div style={{ padding: "100px 0", textAlign: "center" }}>Загрузка каталога...</div>}>
      <CatalogContent />
    </Suspense>
  );
}
