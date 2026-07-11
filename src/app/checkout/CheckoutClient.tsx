"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useCart } from "../../context/CartContext";
import { MOCK_PRODUCTS } from "../../data/mockData";
import { formatPrice } from "../../lib/format";
import { AVAILABLE_SIZES, DEFAULT_RECOMMENDATION_SIZE, DELIVERY } from "../../lib/shop";
import styles from "./checkout.module.css";

export default function CheckoutClient() {
  const { cartItems, cartTotal, addToCart, updateQuantity, removeFromCart } = useCart();

  const [delivery, setDelivery] = useState<"courier" | "pickup" | "post">("courier");
  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    city: "",
    address: "",
    apartment: "",
    zip: "",
    comment: "",
  });
  const [submitted, setSubmitted] = useState(false);
  const [recommendationSizes, setRecommendationSizes] = useState<Record<string, string>>({});

  // Recommend products not already in cart
  const cartIds = cartItems.map((i) => i.product.id);
  const recommendations = MOCK_PRODUCTS.filter((p) => !cartIds.includes(p.id)).slice(0, 3);
  const deliveryPriceLabel = formatPrice(DELIVERY.checkoutPrice);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
  };

  if (submitted) {
    return (
      <div className={styles.empty} style={{ paddingTop: 120 }}>
        <svg width="56" height="56" fill="none" viewBox="0 0 24 24" stroke="var(--text-primary)">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <h2 className={styles.emptyTitle}>Заказ оформлен!</h2>
        <p style={{ fontFamily: "var(--font-sans)", fontSize: 14, color: "var(--text-secondary)", textAlign: "center", lineHeight: 1.6 }}>
          Мы отправили подтверждение на&nbsp;<strong>{form.email || "ваш email"}</strong>.<br />
          Менеджер свяжется с вами в течение 1 рабочего дня.
        </p>
        <Link href="/" className={styles.emptyLink}>Вернуться на главную</Link>
      </div>
    );
  }

  if (cartItems.length === 0) {
    return (
      <div className={styles.empty}>
        <h2 className={styles.emptyTitle}>Корзина пуста</h2>
        <p style={{ fontFamily: "var(--font-sans)", fontSize: 14, color: "var(--text-secondary)" }}>
          Добавьте товары из каталога, чтобы оформить заказ.
        </p>
        <Link href="/catalog" className={styles.emptyLink}>Перейти в каталог</Link>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.layout}>
        {/* ── LEFT COLUMN ── */}
        <div>
          {/* Order Items */}
          <p className={styles.sectionTitle}>Ваш заказ ({cartItems.length})</p>
          <div className={styles.orderList}>
            {cartItems.map((item, i) => (
              <div key={i} className={styles.orderItem}>
                {/* Thumbnail */}
                <div className={styles.orderItemImage}>
                  <Image
                    src={item.product.images[0]}
                    alt={item.product.name}
                    fill
                    sizes="90px"
                    className={styles.orderItemImg}
                  />
                </div>

                {/* Info */}
                <div className={styles.orderItemInfo}>
                  <span className={styles.orderItemName}>{item.product.name}</span>
                  <div className={styles.orderItemMeta}>
                    <span>
                      <span
                        className={styles.orderItemColorDot}
                        style={{ backgroundColor: item.selectedColor.hex }}
                      />
                      {item.selectedColor.name}
                    </span>
                    <span>Размер: {item.selectedSize}</span>
                  </div>
                  {/* Qty controls */}
                  <div className={styles.orderItemQty}>
                    <button
                      className={styles.qtyBtn}
                      onClick={() =>
                        item.quantity > 1
                          ? updateQuantity(item.product.id, item.selectedSize, item.selectedColor.hex, item.quantity - 1)
                          : removeFromCart(item.product.id, item.selectedSize, item.selectedColor.hex)
                      }
                    >
                      −
                    </button>
                    <span className={styles.qtyNum}>{item.quantity}</span>
                    <button
                      className={styles.qtyBtn}
                      onClick={() =>
                        updateQuantity(item.product.id, item.selectedSize, item.selectedColor.hex, item.quantity + 1)
                      }
                    >
                      +
                    </button>
                  </div>
                </div>

                {/* Price */}
                <span className={styles.orderItemPrice}>
                  {formatPrice(item.product.price * item.quantity)}
                </span>
              </div>
            ))}
          </div>

          {/* ── Recommendations ── */}
          {recommendations.length > 0 && (
            <div className={styles.recommendSection}>
              <p className={styles.sectionTitle}>Дополните заказ</p>
              <div className={styles.recommendGrid}>
                {recommendations.map((product) => {
                  const selectedSize = recommendationSizes[product.id] ?? DEFAULT_RECOMMENDATION_SIZE;

                  return (
                  <div key={product.id} className={styles.recommendCard}>
                    <Link href={`/product/${product.id}`}>
                      <div className={styles.recommendImage}>
                        <Image
                          src={product.images[0]}
                          alt={product.name}
                          fill
                          sizes="200px"
                          className={styles.recommendImg}
                        />
                      </div>
                    </Link>
                    <span className={styles.recommendName}>{product.name}</span>
                    <span className={styles.recommendPrice}>{formatPrice(product.price)}</span>
                    <div className={styles.recommendSizes} aria-label={`Размер для ${product.name}`}>
                      {AVAILABLE_SIZES.map((size) => (
                        <button
                          key={size}
                          type="button"
                          className={`${styles.recommendSize} ${
                            selectedSize === size ? styles.recommendSizeActive : ""
                          }`}
                          onClick={() =>
                            setRecommendationSizes((previous) => ({
                              ...previous,
                              [product.id]: size,
                            }))
                          }
                          aria-pressed={selectedSize === size}
                        >
                          {size}
                        </button>
                      ))}
                    </div>
                    <button
                      className={styles.addBtn}
                      onClick={() =>
                        addToCart({
                          product,
                          selectedSize,
                          selectedColor: product.colors[0],
                          quantity: 1,
                        })
                      }
                    >
                      Добавить
                    </button>
                  </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* ── RIGHT COLUMN ── */}
        <div className={styles.rightCol}>
          {/* Summary box */}
          <div className={styles.summaryBox}>
            <p className={styles.sectionTitle}>Итог</p>
            {cartItems.map((item, i) => (
              <div key={i} className={styles.summaryRow}>
                <span>{item.product.name} × {item.quantity}</span>
                <span>{formatPrice(item.product.price * item.quantity)}</span>
              </div>
            ))}
            <div className={styles.summaryRow}>
              <span>Доставка</span>
              <span>{delivery === "pickup" ? "Бесплатно" : formatPrice(DELIVERY.checkoutPrice)}</span>
            </div>
            <div className={styles.summaryTotal}>
              <span>Итого</span>
              <span>{formatPrice(cartTotal + (delivery === "pickup" ? 0 : DELIVERY.checkoutPrice))}</span>
            </div>
          </div>

          {/* Form */}
          <form className={styles.formSection} onSubmit={handleSubmit}>
            <p className={styles.sectionTitle}>Данные получателя</p>

            <div className={styles.formRow}>
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Имя *</label>
                <input
                  name="firstName"
                  required
                  className={styles.formInput}
                  placeholder="Анна"
                  value={form.firstName}
                  onChange={handleChange}
                />
              </div>
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Фамилия *</label>
                <input
                  name="lastName"
                  required
                  className={styles.formInput}
                  placeholder="Иванова"
                  value={form.lastName}
                  onChange={handleChange}
                />
              </div>
            </div>

            <div className={styles.formGroup}>
              <label className={styles.formLabel}>Email *</label>
              <input
                name="email"
                type="email"
                required
                className={styles.formInput}
                placeholder="anna@example.com"
                value={form.email}
                onChange={handleChange}
              />
            </div>

            <div className={styles.formGroup}>
              <label className={styles.formLabel}>Телефон *</label>
              <input
                name="phone"
                type="tel"
                required
                className={styles.formInput}
                placeholder="+7 (999) 000-00-00"
                value={form.phone}
                onChange={handleChange}
              />
            </div>

            <p className={styles.sectionTitle} style={{ marginTop: 8 }}>Доставка</p>

            <div className={styles.deliveryOptions}>
              {[
                { id: "courier", label: "Курьером", sub: `2–4 рабочих дня · ${deliveryPriceLabel}` },
                { id: "pickup", label: "Самовывоз из магазина", sub: "Бесплатно" },
                { id: "post", label: "Почтой России", sub: `5–10 рабочих дней · ${deliveryPriceLabel}` },
              ].map((opt) => (
                <label key={opt.id} className={styles.deliveryOption}>
                  <input
                    type="radio"
                    name="delivery"
                    value={opt.id}
                    checked={delivery === opt.id}
                    onChange={() => setDelivery(opt.id as typeof delivery)}
                  />
                  <span>
                    <strong style={{ display: "block", fontSize: 14, fontFamily: "var(--font-sans)", color: "var(--text-primary)" }}>
                      {opt.label}
                    </strong>
                    <span style={{ fontSize: 12 }}>{opt.sub}</span>
                  </span>
                </label>
              ))}
            </div>

            {delivery !== "pickup" && (
              <>
                <div className={styles.formRow}>
                  <div className={styles.formGroup}>
                    <label className={styles.formLabel}>Город *</label>
                    <input
                      name="city"
                      required
                      className={styles.formInput}
                      placeholder="Москва"
                      value={form.city}
                      onChange={handleChange}
                    />
                  </div>
                  <div className={styles.formGroup}>
                    <label className={styles.formLabel}>Индекс *</label>
                    <input
                      name="zip"
                      required
                      className={styles.formInput}
                      placeholder="123456"
                      value={form.zip}
                      onChange={handleChange}
                    />
                  </div>
                </div>
                <div className={styles.formGroup}>
                  <label className={styles.formLabel}>Адрес *</label>
                  <input
                    name="address"
                    required
                    className={styles.formInput}
                    placeholder="ул. Тверская, д. 1"
                    value={form.address}
                    onChange={handleChange}
                  />
                </div>
                <div className={styles.formGroup}>
                  <label className={styles.formLabel}>Квартира / офис</label>
                  <input
                    name="apartment"
                    className={styles.formInput}
                    placeholder="кв. 42"
                    value={form.apartment}
                    onChange={handleChange}
                  />
                </div>
              </>
            )}

            <div className={styles.formGroup}>
              <label className={styles.formLabel}>Комментарий к заказу</label>
              <textarea
                name="comment"
                className={styles.formInput}
                placeholder="Пожелания по упаковке, время доставки..."
                rows={3}
                value={form.comment}
                onChange={handleChange}
                style={{ resize: "vertical" }}
              />
            </div>

            <button type="submit" className={styles.submitBtn}>
              Подтвердить заказ
            </button>
            <p className={styles.formNote}>
              Нажимая кнопку, вы соглашаетесь с условиями обработки персональных данных и публичной офертой.
            </p>
          </form>
        </div>
      </div>
    </div>
  );
}
