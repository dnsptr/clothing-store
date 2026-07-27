"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useCart } from "../../context/CartContext";
import { useCatalog } from "../../context/CatalogContext";
import { productImageSrc } from "../../lib/assets";
import { formatPrice, formatPriceOrUnknown } from "../../lib/format";
import { isCheckoutEnabled, type MedusaShippingOption } from "../../lib/medusa";
import { DEFAULT_RECOMMENDATION_SIZE, findAddableVariant, selectableSizes } from "../../lib/shop";
import styles from "./checkout.module.css";

// ── Validation helpers ────────────────────────────────────────────────────────

/** Strip spaces, parentheses and dashes, then return +7XXXXXXXXXX or null. */
function normalizePhone(raw: string): string | null {
  const stripped = raw.replace(/[\s()\-]/g, "");
  if (/^(\+7|8)\d{10}$/.test(stripped)) {
    // Normalise 8-prefixed numbers to +7
    return stripped.startsWith("8") ? "+7" + stripped.slice(1) : stripped;
  }
  return null;
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

type FormFields = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  city: string;
  address: string;
  apartment: string;
  zip: string;
  comment: string;
};

type FormErrors = Record<string, string>;

/**
 * Validate all relevant fields. Returns an errors object; empty means valid.
 *
 * Адрес обязателен всегда. Раньше его требование снималось для варианта
 * «Самовывоз», которого не существовало ни в одной опции доставки Medusa: в
 * результате заказ уходил на бэкенд с пустыми городом, улицей и индексом — и
 * при этом с курьерским способом доставки. Исполнить такой заказ нельзя.
 * Появится настоящая опция самовывоза — вернётся и ветка без адреса.
 */
function validateForm(form: FormFields): FormErrors {
  const errors: FormErrors = {};

  if (!form.firstName.trim()) {
    errors.firstName = "Введите имя";
  }

  if (!form.lastName.trim()) {
    errors.lastName = "Введите фамилию";
  }

  if (!form.email.trim()) {
    errors.email = "Введите email";
  } else if (!isValidEmail(form.email)) {
    errors.email = "Неверный формат email";
  }

  if (!form.phone.trim()) {
    errors.phone = "Введите телефон";
  } else if (normalizePhone(form.phone) === null) {
    errors.phone = "Введите номер в формате +7XXXXXXXXXX или 8XXXXXXXXXX";
  }

  if (!form.city.trim()) {
    errors.city = "Введите город";
  }

  if (!form.zip.trim()) {
    errors.zip = "Введите индекс";
  } else if (!/^\d{6}$/.test(form.zip)) {
    errors.zip = "Индекс — 6 цифр";
  }

  if (!form.address.trim()) {
    errors.address = "Введите адрес";
  }

  return errors;
}

/** Validate a single field on blur, returning an error string or "". */
function validateField(name: keyof FormFields, value: string): string {
  switch (name) {
    case "firstName":
      return value.trim() ? "" : "Введите имя";
    case "lastName":
      return value.trim() ? "" : "Введите фамилию";
    case "email":
      if (!value.trim()) return "Введите email";
      return isValidEmail(value) ? "" : "Неверный формат email";
    case "phone":
      if (!value.trim()) return "Введите телефон";
      return normalizePhone(value) !== null ? "" : "Введите номер в формате +7XXXXXXXXXX или 8XXXXXXXXXX";
    case "city":
      return value.trim() ? "" : "Введите город";
    case "zip":
      if (!value.trim()) return "Введите индекс";
      return /^\d{6}$/.test(value) ? "" : "Индекс — 6 цифр";
    case "address":
      return value.trim() ? "" : "Введите адрес";
    default:
      return "";
  }
}

// ─────────────────────────────────────────────────────────────────────────────

export default function CheckoutClient() {
  const { products } = useCatalog();
  const {
    cartItems,
    cartShippingTotal,
    cartTotal,
    addToCart,
    completeCheckout,
    getShippingOptions,
    prepareCheckout,
    updateQuantity,
    removeFromCart,
  } = useCart();

  // Способы доставки приходят из Medusa. Раньше здесь были три захардкоженные
  // радиокнопки («Курьером», «Самовывоз», «Почтой России»), не связанные ни с
  // одной реальной опцией: выбор покупателя никуда не уходил, а в заказ всегда
  // подставлялась единственная существующая опция.
  const [shippingOptions, setShippingOptions] = useState<MedusaShippingOption[] | null>(null);
  const [shippingOptionsFailed, setShippingOptionsFailed] = useState(false);
  const [selectedShippingOptionId, setSelectedShippingOptionId] = useState("");
  const [hasConsented, setHasConsented] = useState(false);
  const [form, setForm] = useState<FormFields>({
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
  const [errors, setErrors] = useState<FormErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isSubmittingRef = useRef(false);
  const [submitMessage, setSubmitMessage] = useState("");
  const [orderId, setOrderId] = useState<string | null>(null);
  const [recommendationSizes, setRecommendationSizes] = useState<Record<string, string>>({});

  // Recommend products not already in cart
  const cartIds = cartItems.map((i) => i.product.id);
  const recommendations = products.filter((p) => !cartIds.includes(p.id)).slice(0, 3);

  const hasCartItems = cartItems.length > 0;
  const needsShippingOptions =
    isCheckoutEnabled && hasCartItems && shippingOptions === null && !shippingOptionsFailed;

  useEffect(() => {
    if (!needsShippingOptions) return;

    let isActive = true;
    getShippingOptions()
      .then((options) => {
        if (!isActive) return;
        setShippingOptions(options);
        // Предвыбор единственного варианта: заставлять выбирать из одного
        // пункта незачем, но и молча подставлять один из нескольких нельзя.
        if (options.length === 1) setSelectedShippingOptionId(options[0].id);
      })
      .catch((error: unknown) => {
        if (!isActive) return;
        console.error("[Checkout] Не удалось загрузить способы доставки.", error);
        setShippingOptionsFailed(true);
      });

    return () => {
      isActive = false;
    };
  }, [needsShippingOptions, getShippingOptions]);

  useEffect(() => {
    const resetSubmission = () => {
      isSubmittingRef.current = false;
      setIsSubmitting(false);
    };
    window.addEventListener("pageshow", resetSubmission);
    return () => window.removeEventListener("pageshow", resetSubmission);
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
    // Clear the error as soon as the user starts correcting the field
    if (errors[name]) {
      setErrors((prev) => ({ ...prev, [name]: "" }));
    }
  };

  const handleBlur = (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    const error = validateField(name as keyof FormFields, value);
    setErrors((prev) => ({ ...prev, [name]: error }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmittingRef.current) return;

    // Run full validation
    const newErrors = validateForm(form);
    if (!selectedShippingOptionId) {
      newErrors.shippingOption = "Выберите способ доставки";
    }
    if (!hasConsented) {
      newErrors.consent = "Подтвердите согласие, чтобы оформить заказ";
    }
    if (Object.values(newErrors).some(Boolean)) {
      setErrors(newErrors);
      return;
    }

    // Build the normalised form data to pass downstream
    const normalizedPhone = normalizePhone(form.phone) ?? form.phone;
    const checkoutDetails = {
      firstName: form.firstName.trim(),
      lastName: form.lastName.trim(),
      email: form.email.trim(),
      phone: normalizedPhone,
      city: form.city.trim(),
      address: form.address.trim(),
      apartment: form.apartment.trim(),
      zip: form.zip,
      shippingOptionId: selectedShippingOptionId,
      comment: form.comment,
    };

    isSubmittingRef.current = true;
    setIsSubmitting(true);
    setSubmitMessage("");
    let redirectStarted = false;
    try {
      await prepareCheckout(checkoutDetails);
      const result = await completeCheckout();
      if (result.type === "redirect") {
        window.location.assign(result.paymentUrl);
        redirectStarted = true;
        return;
      }
      setOrderId(result.displayId ? String(result.displayId) : result.id);
    } catch (error) {
      setSubmitMessage(error instanceof Error ? error.message : "Не удалось сохранить checkout.");
    } finally {
      if (!redirectStarted) {
        isSubmittingRef.current = false;
        setIsSubmitting(false);
      }
    }
  };

  // Пока платёжный провайдер не подключён, форму заказа показывать нельзя:
  // встроенный провайдер Medusa авторизует любой платёж, поэтому заказ
  // создался бы без оплаты, зарезервировал остаток и остался бы без чека.
  if (!isCheckoutEnabled) {
    return (
      <div className={styles.empty}>
        <h2 className={styles.emptyTitle}>Оформление заказа временно недоступно</h2>
        <p className={styles.emptyText}>
          Мы заканчиваем подключение онлайн-оплаты. Товары останутся в корзине —
          оформить заказ можно будет сразу после запуска приёма платежей.
        </p>
        <Link href="/cart" className={styles.emptyLink}>Вернуться в корзину</Link>
      </div>
    );
  }

  if (orderId) {
    return (
      <div className={`${styles.empty} ${styles.emptySubmitted}`}>
        <h2 className={styles.emptyTitle}>Заказ оформлен</h2>
        <p className={styles.emptyText}>
          Номер заказа — №{orderId}. Мы отправили подтверждение на {form.email} и
          свяжемся с вами по указанному телефону.
        </p>
        <Link href="/" className={styles.emptyLink}>Вернуться на главную</Link>
      </div>
    );
  }

  if (cartItems.length === 0) {
    return (
      <div className={styles.empty}>
        <h2 className={styles.emptyTitle}>Корзина пуста</h2>
        <p className={styles.emptyText}>
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
                    src={productImageSrc(item.product.images)}
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
                  {formatPrice(item.lineTotal ?? item.product.price * item.quantity)}
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
                  const sizes = selectableSizes(product);
                  const selectedSize = recommendationSizes[product.id] ??
                    (sizes.includes(DEFAULT_RECOMMENDATION_SIZE) ? DEFAULT_RECOMMENDATION_SIZE : sizes[0]);
                  const addableVariant = findAddableVariant(product, { size: selectedSize });

                  return (
                  <div key={product.id} className={styles.recommendCard}>
                    <Link href={`/product/${product.id}`}>
                      <div className={styles.recommendImage}>
                        <Image
                          src={productImageSrc(product.images)}
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
                      {sizes.map((size) => (
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
                      type="button"
                      className={styles.addBtn}
                      onClick={() => {
                        if (!addableVariant) return;
                        addToCart({
                          product,
                          selectedSize,
                          selectedColor: product.colors[0],
                          variantId: addableVariant.variantId,
                          quantity: 1,
                        });
                      }}
                      disabled={!addableVariant}
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
                <span>{formatPrice(item.lineTotal ?? item.product.price * item.quantity)}</span>
              </div>
            ))}
            <div className={styles.summaryRow}>
              <span>Доставка</span>
              <span>{cartShippingTotal === 0 ? "Бесплатно" : formatPriceOrUnknown(cartShippingTotal)}</span>
            </div>
            <div className={styles.summaryTotal}>
              <span>Итого</span>
              <span>{formatPriceOrUnknown(cartTotal)}</span>
            </div>
          </div>

          {/* Form */}
          <form className={styles.formSection} onSubmit={handleSubmit} noValidate>
            <p className={styles.sectionTitle}>Данные получателя</p>

            <div className={styles.formRow}>
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Имя *</label>
                <input
                  name="firstName"
                  required
                  maxLength={100}
                  className={`${styles.formInput}${errors.firstName ? ` ${styles.formInputError}` : ""}`}
                  placeholder="Анна"
                  value={form.firstName}
                  onChange={handleChange}
                  onBlur={handleBlur}
                />
                {errors.firstName && <span className={styles.fieldError}>{errors.firstName}</span>}
              </div>
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Фамилия *</label>
                <input
                  name="lastName"
                  required
                  maxLength={100}
                  className={`${styles.formInput}${errors.lastName ? ` ${styles.formInputError}` : ""}`}
                  placeholder="Иванова"
                  value={form.lastName}
                  onChange={handleChange}
                  onBlur={handleBlur}
                />
                {errors.lastName && <span className={styles.fieldError}>{errors.lastName}</span>}
              </div>
            </div>

            <div className={styles.formGroup}>
              <label className={styles.formLabel}>Email *</label>
              <input
                name="email"
                type="email"
                required
                className={`${styles.formInput}${errors.email ? ` ${styles.formInputError}` : ""}`}
                placeholder="anna@example.com"
                value={form.email}
                onChange={handleChange}
                onBlur={handleBlur}
              />
              {errors.email && <span className={styles.fieldError}>{errors.email}</span>}
            </div>

            <div className={styles.formGroup}>
              <label className={styles.formLabel}>Телефон *</label>
              <input
                name="phone"
                type="tel"
                inputMode="tel"
                required
                className={`${styles.formInput}${errors.phone ? ` ${styles.formInputError}` : ""}`}
                placeholder="+7 (999) 000-00-00"
                value={form.phone}
                onChange={handleChange}
                onBlur={handleBlur}
              />
              {errors.phone && <span className={styles.fieldError}>{errors.phone}</span>}
            </div>

            <p className={`${styles.sectionTitle} ${styles.sectionTitleSpaced}`}>Доставка</p>

            {shippingOptionsFailed ? (
              <p className={styles.fieldError} role="alert">
                Не удалось загрузить способы доставки. Обновите страницу и попробуйте ещё раз.
              </p>
            ) : shippingOptions === null ? (
              <p className={styles.deliverySub} role="status" aria-live="polite">
                Загружаем способы доставки…
              </p>
            ) : shippingOptions.length === 0 ? (
              <p className={styles.fieldError} role="alert">
                Для этого заказа нет доступных способов доставки. Напишите нам — подберём вариант.
              </p>
            ) : (
              <div className={styles.deliveryOptions}>
                {shippingOptions.map((option) => (
                  <label key={option.id} className={styles.deliveryOption}>
                    <input
                      type="radio"
                      name="shippingOption"
                      value={option.id}
                      checked={selectedShippingOptionId === option.id}
                      onChange={() => {
                        setSelectedShippingOptionId(option.id);
                        setErrors((prev) => ({ ...prev, shippingOption: "" }));
                      }}
                    />
                    <span>
                      <strong className={styles.deliveryLabel}>{option.name}</strong>
                      <span className={styles.deliverySub}>
                        {typeof option.amount === "number"
                          ? option.amount === 0
                            ? "Бесплатно"
                            : formatPrice(option.amount)
                          : "Стоимость рассчитается после ввода адреса"}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            )}
            {errors.shippingOption && (
              <span className={styles.fieldError}>{errors.shippingOption}</span>
            )}

            <div className={styles.formRow}>
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Город *</label>
                <input
                  name="city"
                  required
                  maxLength={100}
                  className={`${styles.formInput}${errors.city ? ` ${styles.formInputError}` : ""}`}
                  placeholder="Москва"
                  value={form.city}
                  onChange={handleChange}
                  onBlur={handleBlur}
                />
                {errors.city && <span className={styles.fieldError}>{errors.city}</span>}
              </div>
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Индекс *</label>
                <input
                  name="zip"
                  required
                  inputMode="numeric"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  className={`${styles.formInput}${errors.zip ? ` ${styles.formInputError}` : ""}`}
                  placeholder="123456"
                  value={form.zip}
                  onChange={handleChange}
                  onBlur={handleBlur}
                />
                {errors.zip && <span className={styles.fieldError}>{errors.zip}</span>}
              </div>
            </div>
            <div className={styles.formGroup}>
              <label className={styles.formLabel}>Адрес *</label>
              <input
                name="address"
                required
                className={`${styles.formInput}${errors.address ? ` ${styles.formInputError}` : ""}`}
                placeholder="ул. Тверская, д. 1"
                value={form.address}
                onChange={handleChange}
                onBlur={handleBlur}
              />
              {errors.address && <span className={styles.fieldError}>{errors.address}</span>}
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

            <div className={styles.formGroup}>
              <label className={styles.formLabel}>Комментарий к заказу</label>
              <textarea
                name="comment"
                className={styles.formInput}
                placeholder="Пожелания по упаковке, время доставки..."
                rows={3}
                value={form.comment}
                onChange={handleChange}
              />
            </div>

            {/* Согласие фиксируется отдельным действием покупателя, а не
                надписью под кнопкой: подтверждать согласие с документом нужно
                осознанно, а сам факт согласия — доказуемо. */}
            <label className={styles.consent}>
              <input
                type="checkbox"
                checked={hasConsented}
                onChange={(event) => {
                  setHasConsented(event.target.checked);
                  if (event.target.checked) setErrors((prev) => ({ ...prev, consent: "" }));
                }}
              />
              <span>
                Оформляя заказ, я соглашаюсь с условиями{" "}
                <Link href="/info/offer" target="_blank">
                  публичной оферты
                </Link>{" "}
                и{" "}
                <Link href="/info/privacy" target="_blank">
                  политикой обработки персональных данных
                </Link>
                .
              </span>
            </label>
            {errors.consent && <span className={styles.fieldError}>{errors.consent}</span>}

            <button type="submit" className={styles.submitBtn} disabled={isSubmitting}>
              {isSubmitting ? "Оформляем..." : "Подтвердить заказ"}
            </button>
            {submitMessage && <p className={styles.formNote} role="alert">{submitMessage}</p>}
          </form>
        </div>
      </div>
    </div>
  );
}
