"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { Product } from "../../../data/mockData";
import { useCart } from "../../../context/CartContext";
import SizeGuideModal from "../../../components/SizeGuideModal";
import styles from "./product.module.css";

const AVAILABLE_SIZES = ["XS", "S", "M", "L", "XL"];

export default function ProductDetailClient({ product }: { product: Product }) {
  const { addToCart } = useCart();
  const [selectedColor, setSelectedColor] = useState<{ name: string; hex: string } | null>(
    product.colors.length > 0 ? product.colors[0] : null
  );
  const [selectedSize, setSelectedSize] = useState<string>("");
  const [isSizeGuideOpen, setIsSizeGuideOpen] = useState(false);
  const [error, setError] = useState("");
  
  const [openAccordions, setOpenAccordions] = useState<Record<string, boolean>>({
    description: true,
    composition: false,
    model: false,
    shipping: false,
  });

  const handleAddToCart = () => {
    if (!selectedSize) {
      setError("Пожалуйста, выберите размер");
      return;
    }

    if (!selectedColor) return;

    setError("");
    addToCart({
      product,
      selectedSize,
      selectedColor,
      quantity: 1,
    });
  };

  const toggleAccordion = (section: string) => {
    setOpenAccordions((prev) => ({
      ...prev,
      [section]: !prev[section],
    }));
  };

  const formatPrice = (price: number) => {
    return price.toLocaleString("ru-RU") + " ₽";
  };

  return (
    <>
      {/* Main Layout Grid */}
      <div className={styles.grid}>
        {/* Left Column: Image Gallery Stack */}
        <div className={styles.gallery}>
          {product.images.map((imgUrl, index) => (
            <div key={index} className={styles.imageWrapper}>
              <Image
                src={imgUrl}
                alt={`${product.name} - Ракурс ${index + 1}`}
                fill
                sizes="(max-width: 768px) 100vw, 55vw"
                className={styles.image}
                priority={index === 0}
              />
            </div>
          ))}
        </div>

        {/* Right Column: Sticky Options Sidebar */}
        <div className={styles.sidebar}>
          <div className={styles.details}>
            {/* Header Information */}
            <div className={styles.header}>
              <span className={styles.category}>{product.category}</span>
              <h1 className={styles.title}>{product.name}</h1>
              <span className={styles.price}>{formatPrice(product.price)}</span>
            </div>

            {/* Color Selector */}
            {product.colors && product.colors.length > 0 && (
              <div>
                <h3 className={styles.optionTitle}>Цвет: {selectedColor?.name}</h3>
                <div className={styles.colorList}>
                  {product.colors.map((color) => (
                    <button
                      key={color.name}
                      className={`${styles.colorDot} ${
                        selectedColor?.hex === color.hex ? styles.colorDotActive : ""
                      }`}
                      style={{ backgroundColor: color.hex }}
                      onClick={() => setSelectedColor(color)}
                      aria-label={`Выбрать цвет ${color.name}`}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Size Selector */}
            <div>
              <div className={styles.sizeSectionHeader}>
                <h3 className={styles.optionTitle}>Размер</h3>
                <button
                  className={styles.sizeGuideLink}
                  onClick={() => setIsSizeGuideOpen(true)}
                >
                  Таблица размеров
                </button>
              </div>
              <div className={styles.sizeList}>
                {AVAILABLE_SIZES.map((size) => (
                  <button
                    key={size}
                    className={`${styles.sizeBtn} ${
                      selectedSize === size ? styles.sizeBtnActive : ""
                    }`}
                    onClick={() => {
                      setSelectedSize(size);
                      setError("");
                    }}
                  >
                    {size}
                  </button>
                ))}
              </div>
              {error && <span className={styles.error}>{error}</span>}
            </div>

            {/* Main Action Button */}
            <button className={styles.addToCartBtn} onClick={handleAddToCart}>
              Добавить в корзину
            </button>

            {/* Accordions Block */}
            <div className={styles.accordions}>
              {/* Accordion 1: Description */}
              <div className={styles.accordion}>
                <button
                  className={styles.accordionHeader}
                  onClick={() => toggleAccordion("description")}
                >
                  <span>Описание и силуэт</span>
                  <span className={styles.accordionIcon}>
                    {openAccordions.description ? "−" : "+"}
                  </span>
                </button>
                <div
                  className={`${styles.accordionContent} ${
                    openAccordions.description ? styles.accordionContentOpen : ""
                  }`}
                >
                  <div className={styles.accordionInner}>
                    Изделие выполнено из премиального материала с заботой о комфорте. Отличается лаконичным силуэтом, который легко вписывается в базовый гардероб. Свободный крой оставляет свободу движениям и формирует расслабленные образы.
                    <br />
                    <br />
                    • Свободный силуэт
                    <br />
                    • Качественная обработка внутренних швов
                    <br />• Износостойкий и экологичный материал
                  </div>
                </div>
              </div>

              {/* Accordion 2: Materials & Care */}
              <div className={styles.accordion}>
                <button
                  className={styles.accordionHeader}
                  onClick={() => toggleAccordion("composition")}
                >
                  <span>Состав и уход</span>
                  <span className={styles.accordionIcon}>
                    {openAccordions.composition ? "−" : "+"}
                  </span>
                </button>
                <div
                  className={`${styles.accordionContent} ${
                    openAccordions.composition ? styles.accordionContentOpen : ""
                  }`}
                >
                  <div className={styles.accordionInner}>
                    <strong>Состав:</strong> 100% натуральный материал премиум-качества.
                    <br />
                    <br />
                    <strong>Уход:</strong>
                    <br />
                    • Ручная или машинная стирка на деликатном режиме при температуре не выше 30°C
                    <br />
                    • Не отбеливать и не использовать агрессивные моющие средства
                    <br />
                    • Сушить в расправленном виде на горизонтальной поверхности
                    <br />• Гладить при умеренной температуре с изнаночной стороны
                  </div>
                </div>
              </div>

              {/* Accordion 3: Model Parameters */}
              <div className={styles.accordion}>
                <button
                  className={styles.accordionHeader}
                  onClick={() => toggleAccordion("model")}
                >
                  <span>Параметры модели</span>
                  <span className={styles.accordionIcon}>
                    {openAccordions.model ? "−" : "+"}
                  </span>
                </button>
                <div
                  className={`${styles.accordionContent} ${
                    openAccordions.model ? styles.accordionContentOpen : ""
                  }`}
                >
                  <div className={styles.accordionInner}>
                    Рост модели на фото: 178 см.
                    <br />
                    На модели надет размер: S.
                    <br />
                    Параметры модели: обхват груди — 84 см, обхват талии — 60 см, обхват бедер — 89 см.
                  </div>
                </div>
              </div>

              {/* Accordion 4: Shipping & Returns */}
              <div className={styles.accordion}>
                <button
                  className={styles.accordionHeader}
                  onClick={() => toggleAccordion("shipping")}
                >
                  <span>Доставка и возврат</span>
                  <span className={styles.accordionIcon}>
                    {openAccordions.shipping ? "−" : "+"}
                  </span>
                </button>
                <div
                  className={`${styles.accordionContent} ${
                    openAccordions.shipping ? styles.accordionContentOpen : ""
                  }`}
                >
                  <div className={styles.accordionInner}>
                    <strong>Доставка:</strong>
                    <br />
                    • Бесплатная доставка курьером по всей России при заказе от 15 000 ₽.
                    <br />
                    • Доставка курьером до двери с возможностью примерки.
                    <br />
                    • Сроки доставки: Москва — 1-2 рабочих дня, другие крупные города — 2-4 рабочих дня, регионы РФ — до 7 рабочих дней.
                    <br />
                    <br />
                    <strong>Возврат:</strong>
                    <br />
                    • Вы можете легко вернуть товар в течение 14 календарных дней после получения, если он сохранил товарный вид и ярлыки.
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Sizing Guide Overlay */}
      <SizeGuideModal
        isOpen={isSizeGuideOpen}
        onClose={() => setIsSizeGuideOpen(false)}
      />
    </>
  );
}
