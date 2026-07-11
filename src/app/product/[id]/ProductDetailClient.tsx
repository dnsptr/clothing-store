"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { MOCK_PRODUCTS, Product } from "../../../data/mockData";
import { useCart } from "../../../context/CartContext";
import SizeGuideModal from "../../../components/SizeGuideModal";
import { formatPrice } from "../../../lib/format";
import { AVAILABLE_SIZES } from "../../../lib/shop";
import styles from "./product.module.css";

const PRODUCT_PANELS = [
  {
    id: "stores",
    title: "Наличие в магазинах",
    content: "Проверьте наличие в магазинах Москвы и других городов. Мы подготовим изделие к примерке.",
  },
  {
    id: "measurements",
    title: "Обмеры изделия",
    content: "Длина по спинке: 74 см. Длина рукава: 62 см. Измерения выполнены для размера S.",
  },
  {
    id: "care",
    title: "Состав и уход",
    content: "100% натуральный материал. Бережная стирка при температуре до 30°C, не отбеливать, сушить в расправленном виде.",
  },
];

function BookmarkIcon({ active }: { active: boolean }) {
  return (
    <svg fill={active ? "currentColor" : "none"} stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.25" d="M6.5 4.75h11v15l-5.5-3.4-5.5 3.4v-15Z" />
    </svg>
  );
}

function ChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg className={`${styles.chevron} ${expanded ? styles.chevronOpen : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.25" d="m9 5 7 7-7 7" />
    </svg>
  );
}

export default function ProductDetailClient({ product }: { product: Product }) {
  const { addToCart } = useCart();
  const [selectedColor, setSelectedColor] = useState(product.colors[0] ?? null);
  const [selectedSize, setSelectedSize] = useState("");
  const [isSizeGuideOpen, setIsSizeGuideOpen] = useState(false);
  const [error, setError] = useState("");
  const [savedPhotoIndexes, setSavedPhotoIndexes] = useState<number[]>([]);
  const [openPanels, setOpenPanels] = useState<Record<string, boolean>>({});

  const lookProducts = MOCK_PRODUCTS.filter((item) => item.id !== product.id).slice(0, 2);

  const handleAddToCart = () => {
    if (!selectedSize) {
      setError("Пожалуйста, выберите размер");
      return;
    }

    if (!selectedColor) {
      return;
    }

    setError("");
    addToCart({ product, selectedSize, selectedColor, quantity: 1 });
  };

  const toggleSavedPhoto = (index: number) => {
    setSavedPhotoIndexes((previous) =>
      previous.includes(index) ? previous.filter((item) => item !== index) : [...previous, index]
    );
  };

  const togglePanel = (id: string) => {
    setOpenPanels((previous) => ({ ...previous, [id]: !previous[id] }));
  };

  return (
    <>
      <div className={styles.productGrid}>
        <div className={styles.gallery} aria-label="Фотографии изделия">
          {product.images.map((imageUrl, index) => {
            const isSaved = savedPhotoIndexes.includes(index);

            return (
              <figure className={styles.imageWrapper} key={imageUrl}>
                <Image
                  src={imageUrl}
                  alt={`${product.name}, ракурс ${index + 1}`}
                  fill
                  sizes="(max-width: 767px) 100vw, (max-width: 1100px) 58vw, 560px"
                  className={styles.image}
                  priority={index < 2}
                />
                <button
                  type="button"
                  className={`${styles.photoBookmark} ${isSaved ? styles.photoBookmarkActive : ""}`}
                  onClick={() => toggleSavedPhoto(index)}
                  aria-label={isSaved ? "Убрать фото из избранного" : "Сохранить фото в избранное"}
                  aria-pressed={isSaved}
                >
                  <BookmarkIcon active={isSaved} />
                </button>
              </figure>
            );
          })}
        </div>

        <aside className={styles.sidebar} aria-label="Информация об изделии">
          <div className={styles.details}>
            <div className={styles.productHeader}>
              <p className={styles.category}>{product.category}</p>
              <h1 className={styles.title}>{product.name}</h1>
              <p className={styles.price}>{formatPrice(product.price)}</p>
            </div>

            <section className={styles.optionSection} aria-labelledby="color-title">
              <h2 className={styles.optionTitle} id="color-title">
                Цвет: {selectedColor?.name}
              </h2>
              <div className={styles.colorList}>
                {product.colors.map((color) => {
                  const isSelected = selectedColor?.hex === color.hex;

                  return (
                    <button
                      type="button"
                      key={color.name}
                      className={`${styles.colorDot} ${isSelected ? styles.colorDotActive : ""}`}
                      style={{ backgroundColor: color.hex }}
                      onClick={() => setSelectedColor(color)}
                      aria-label={`Выбрать цвет ${color.name}`}
                      aria-pressed={isSelected}
                    />
                  );
                })}
              </div>
            </section>

            <section className={styles.optionSection} aria-labelledby="size-title">
              <div className={styles.sizeSectionHeader}>
                <h2 className={styles.optionTitle} id="size-title">
                  Размер
                </h2>
                <button type="button" className={styles.sizeGuideLink} onClick={() => setIsSizeGuideOpen(true)}>
                  Таблица размеров
                </button>
              </div>
              <div className={styles.sizeList} role="group" aria-label="Выбор размера">
                {AVAILABLE_SIZES.map((size) => {
                  const isSelected = selectedSize === size;

                  return (
                    <button
                      type="button"
                      key={size}
                      className={`${styles.sizeBtn} ${isSelected ? styles.sizeBtnActive : ""}`}
                      onClick={() => {
                        setSelectedSize(size);
                        setError("");
                      }}
                      aria-pressed={isSelected}
                    >
                      {size}
                    </button>
                  );
                })}
              </div>
              {error && <p className={styles.error}>{error}</p>}
            </section>

            <button type="button" className={styles.addToCartBtn} onClick={handleAddToCart}>
              Добавить в корзину
            </button>

            <div className={styles.productFacts}>
              <p>Артикул: 137833</p>
              <p>Параметры модели: 180/86/62/92</p>
              <p>На модели размер: S</p>
            </div>

            <div className={styles.description}>
              <p>1. Мягкий материал из 100% хлопка - тактильно приятный, с выразительной фактурой.</p>
              <p>2. Легко впишется в повседневный гардероб благодаря продуманному силуэту.</p>
              <button type="button" className={styles.moreButton}>
                ...ЕЩЁ
              </button>
            </div>

            <div className={styles.accordions}>
              {PRODUCT_PANELS.map((panel) => {
                const isOpen = Boolean(openPanels[panel.id]);

                return (
                  <div className={styles.accordion} key={panel.id}>
                    <button
                      type="button"
                      className={styles.accordionHeader}
                      onClick={() => togglePanel(panel.id)}
                      aria-expanded={isOpen}
                    >
                      <span>{panel.title}</span>
                      <ChevronIcon expanded={isOpen} />
                    </button>
                    <div className={`${styles.accordionContent} ${isOpen ? styles.accordionContentOpen : ""}`}>
                      <p className={styles.accordionInner}>{panel.content}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </aside>
      </div>

      <section className={styles.outfit} aria-labelledby="outfit-title">
        <h2 className={styles.outfitTitle} id="outfit-title">
          Весь образ на фото
        </h2>
        <div className={styles.outfitGrid}>
          {lookProducts.map((item) => (
            <article className={styles.outfitCard} key={item.id}>
              <Link href={`/product/${item.id}`} className={styles.outfitImageLink} aria-label={item.name}>
                <Image src={item.images[0]} alt={item.name} fill sizes="264px" className={styles.outfitImage} />
              </Link>
              <Link href={`/product/${item.id}`} className={styles.outfitName}>
                {item.name}
              </Link>
              <p className={styles.outfitPrice}>{formatPrice(item.price)}</p>
            </article>
          ))}
        </div>
      </section>

      <SizeGuideModal isOpen={isSizeGuideOpen} onClose={() => setIsSizeGuideOpen(false)} />
    </>
  );
}
