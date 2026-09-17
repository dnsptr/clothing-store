"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useCart } from "../../context/CartContext";
import { useCatalog } from "../../context/CatalogContext";
import { productImageSrc } from "../../lib/assets";
import { formatPrice, formatPriceOrUnknown } from "../../lib/format";
import { isCheckoutEnabled, type MedusaShippingOption } from "../../lib/medusa";
import {
  type CdekCity,
  type CdekDeliveryPoint,
  type CdekDeliveryEstimate,
  searchCdekCities,
  fetchCdekDeliveryPoints,
  estimateCdekDelivery,
  MARIO_MIKKE_PICKUP_STORES,
} from "../../lib/cdek";
import { DEFAULT_RECOMMENDATION_SIZE, findAddableVariant, selectableSizes } from "../../lib/shop";
import styles from "./checkout.module.css";

export type DeliveryType = "cdek-pvz" | "cdek-courier" | "pickup-store";

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
 * Validate all relevant fields based on selected delivery type.
 */
function validateForm(
  form: FormFields,
  deliveryType: DeliveryType,
  selectedPvz: CdekDeliveryPoint | null,
  selectedStoreId: string,
  deliveryCity: string,
): FormErrors {
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

  if (deliveryType === "cdek-pvz") {
    if (!deliveryCity.trim()) {
      errors.city = "Введите город получения";
    }
    if (!selectedPvz) {
      errors.pvz = "Выберите пункт выдачи СДЭК";
    }
  } else if (deliveryType === "cdek-courier") {
    if (!deliveryCity.trim()) {
      errors.city = "Введите город доставки";
    }
    if (!form.address.trim()) {
      errors.address = "Введите улицу и дом";
    }
    if (!form.zip.trim()) {
      errors.zip = "Введите индекс";
    } else if (!/^\d{6}$/.test(form.zip)) {
      errors.zip = "Индекс — 6 цифр";
    }
  } else if (deliveryType === "pickup-store") {
    if (!selectedStoreId) {
      errors.pickupStore = "Выберите магазин для самовывоза";
    }
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

  // Способы доставки Medusa
  const [shippingOptions, setShippingOptions] = useState<MedusaShippingOption[] | null>(null);
  const [shippingOptionsFailed, setShippingOptionsFailed] = useState(false);
  const [selectedShippingOptionId, setSelectedShippingOptionId] = useState("");
  const [hasConsented, setHasConsented] = useState(false);

  // Delivery module state
  const [deliveryType, setDeliveryType] = useState<DeliveryType>("cdek-pvz");
  const [deliveryCity, setDeliveryCity] = useState("Москва");
  const [cdekCityCode, setCdekCityCode] = useState(44);
  const [citySuggestions, setCitySuggestions] = useState<CdekCity[]>([]);
  const [showCityDropdown, setShowCityDropdown] = useState(false);
  const citySearchTimeout = useRef<NodeJS.Timeout | null>(null);
  const cityWrapperRef = useRef<HTMLDivElement>(null);

  // PVZ state
  const [pvzList, setPvzList] = useState<CdekDeliveryPoint[]>([]);
  const [isLoadingPvz, setIsLoadingPvz] = useState(true);
  const [selectedPvz, setSelectedPvz] = useState<CdekDeliveryPoint | null>(null);
  const [pvzSearchQuery, setPvzSearchQuery] = useState("");
  const [isPvzPickerOpen, setIsPvzPickerOpen] = useState(false);

  // Pickup Store state
  const [selectedStoreId, setSelectedStoreId] = useState(MARIO_MIKKE_PICKUP_STORES[0].id);

  // Estimate state
  const [estimate, setEstimate] = useState<CdekDeliveryEstimate | null>(null);

  const staticPickupEstimate: CdekDeliveryEstimate = {
    deliverySum: 0,
    periodMin: 0,
    periodMax: 0,
    customerCost: 0,
  };
  const activeEstimate = deliveryType === "pickup-store" ? staticPickupEstimate : estimate;

  const [form, setForm] = useState<FormFields>({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    city: "Москва",
    address: "",
    apartment: "",
    zip: "101000",
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

  const matchShippingOption = (type: DeliveryType, options: MedusaShippingOption[] | null): string => {
    if (!options || options.length === 0) return "";
    const match = options.find((opt) => {
      const code = (opt.type?.code || "").toLowerCase();
      const name = opt.name.toLowerCase();
      if (type === "cdek-pvz") return code === "cdek-pvz" || name.includes("пвз") || name.includes("пункт");
      if (type === "cdek-courier") return code === "cdek-courier" || name.includes("курьер");
      if (type === "pickup-store") return code === "pickup-store" || name.includes("самовывоз");
      return false;
    });
    return match ? match.id : options[0].id;
  };

  const effectiveShippingOptionId =
    selectedShippingOptionId || matchShippingOption(deliveryType, shippingOptions);

  useEffect(() => {
    if (!needsShippingOptions) return;

    let isActive = true;
    getShippingOptions()
      .then((options) => {
        if (!isActive) return;
        setShippingOptions(options);
        const matched = matchShippingOption(deliveryType, options);
        if (matched) setSelectedShippingOptionId(matched);
      })
      .catch((error: unknown) => {
        if (!isActive) return;
        console.error("[Checkout] Не удалось загрузить способы доставки.", error);
        setShippingOptionsFailed(true);
      });

    return () => {
      isActive = false;
    };
  }, [needsShippingOptions, getShippingOptions, deliveryType]);

  // Click outside to close city dropdown
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (cityWrapperRef.current && !cityWrapperRef.current.contains(event.target as Node)) {
        setShowCityDropdown(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Fetch PVZ list when city or mode changes
  useEffect(() => {
    if (deliveryType !== "cdek-pvz") return;
    let active = true;
    fetchCdekDeliveryPoints(cdekCityCode)
      .then((points) => {
        if (!active) return;
        setPvzList(points);
        setSelectedPvz((prev) => {
          if (prev && points.some((p) => p.code === prev.code)) return prev;
          return points[0] || null;
        });
      })
      .catch((err) => console.warn("Failed to fetch PVZ", err))
      .finally(() => {
        if (active) setIsLoadingPvz(false);
      });
    return () => {
      active = false;
    };
  }, [cdekCityCode, deliveryType]);

  // Estimate delivery tariff & timeline
  useEffect(() => {
    if (deliveryType === "pickup-store") return;
    let active = true;
    estimateCdekDelivery(cdekCityCode, deliveryType === "cdek-pvz" ? "pvz" : "courier")
      .then((est) => {
        if (active) setEstimate(est);
      })
      .catch((err) => console.warn("Failed to estimate delivery", err));
    return () => {
      active = false;
    };
  }, [cdekCityCode, deliveryType]);

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

  const handleCityChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setDeliveryCity(value);
    setForm((prev) => ({ ...prev, city: value }));
    if (errors.city) {
      setErrors((prev) => ({ ...prev, city: "" }));
    }

    if (citySearchTimeout.current) {
      clearTimeout(citySearchTimeout.current);
    }

    if (value.trim().length >= 2) {
      citySearchTimeout.current = setTimeout(async () => {
        try {
          const results = await searchCdekCities(value);
          setCitySuggestions(results);
          setShowCityDropdown(results.length > 0);
        } catch {
          setCitySuggestions([]);
        }
      }, 250);
    } else {
      setShowCityDropdown(false);
    }
  };

  const handleSelectCity = (city: CdekCity) => {
    setDeliveryCity(city.city);
    setCdekCityCode(city.code);
    setForm((prev) => ({ ...prev, city: city.city }));
    setShowCityDropdown(false);
    setIsPvzPickerOpen(true);
    setSelectedPvz(null);
    setErrors((prev) => ({ ...prev, city: "" }));
  };

  const handleBlur = (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    const error = validateField(name as keyof FormFields, value);
    setErrors((prev) => ({ ...prev, [name]: error }));
  };

  const filteredPvz = pvzList.filter((p) => {
    const q = pvzSearchQuery.trim().toLowerCase();
    if (!q) return true;
    return (
      p.location.address.toLowerCase().includes(q) ||
      (p.nearest_metro_station && p.nearest_metro_station.toLowerCase().includes(q)) ||
      p.code.toLowerCase().includes(q) ||
      p.name.toLowerCase().includes(q)
    );
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmittingRef.current) return;

    // Run full validation
    const newErrors = validateForm(
      form,
      deliveryType,
      selectedPvz,
      selectedStoreId,
      deliveryCity,
    );

    if (!effectiveShippingOptionId && shippingOptions && shippingOptions.length > 0) {
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

    let finalCity = deliveryCity.trim() || form.city.trim() || "Москва";
    let finalAddress = form.address.trim();
    let finalZip = form.zip.trim() || "101000";
    let cdekPvzCode: string | undefined;
    let cdekPvzAddress: string | undefined;
    let pickupStoreId: string | undefined;
    let pickupStoreName: string | undefined;

    if (deliveryType === "cdek-pvz") {
      finalCity = deliveryCity.trim() || "Москва";
      finalAddress = selectedPvz ? selectedPvz.location.address : form.address.trim();
      finalZip = "101000";
      cdekPvzCode = selectedPvz?.code;
      cdekPvzAddress = selectedPvz ? `${selectedPvz.name}, ${selectedPvz.location.address}` : undefined;
    } else if (deliveryType === "cdek-courier") {
      finalCity = deliveryCity.trim();
      finalAddress = form.address.trim();
      finalZip = form.zip.trim();
    } else if (deliveryType === "pickup-store") {
      const store = MARIO_MIKKE_PICKUP_STORES.find((s) => s.id === selectedStoreId) || MARIO_MIKKE_PICKUP_STORES[0];
      finalCity = "Москва";
      finalAddress = `${store.name}, ${store.address}`;
      finalZip = "125212";
      pickupStoreId = store.id;
      pickupStoreName = store.name;
    }

    const checkoutDetails = {
      firstName: form.firstName.trim(),
      lastName: form.lastName.trim(),
      email: form.email.trim(),
      phone: normalizedPhone,
      city: finalCity,
      address: finalAddress,
      apartment: deliveryType === "cdek-courier" ? form.apartment.trim() : "",
      zip: finalZip,
      shippingOptionId: effectiveShippingOptionId || (shippingOptions?.[0]?.id ?? "mvp-ru"),
      comment: form.comment,
      deliveryType,
      cdekPvzCode,
      cdekPvzAddress,
      pickupStoreId,
      pickupStoreName,
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

            <p className={`${styles.sectionTitle} ${styles.sectionTitleSpaced}`}>Способ доставки</p>

            {shippingOptionsFailed && (
              <p className={styles.fieldError} role="alert" style={{ marginBottom: 12 }}>
                Не удалось обновить доступные тарифы Medusa, используются стандартные тарифы доставки.
              </p>
            )}

            {/* Delivery Tabs */}
            <div className={styles.deliveryTabs} role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={deliveryType === "cdek-pvz"}
                className={`${styles.deliveryTab} ${deliveryType === "cdek-pvz" ? styles.deliveryTabActive : ""}`}
                onClick={() => {
                  setDeliveryType("cdek-pvz");
                  setErrors((prev) => ({ ...prev, pvz: "", pickupStore: "", address: "", zip: "" }));
                }}
              >
                <span>ПВЗ СДЭК</span>
                <span className={styles.deliveryTabSub}>Пункт или постамат</span>
              </button>

              <button
                type="button"
                role="tab"
                aria-selected={deliveryType === "cdek-courier"}
                className={`${styles.deliveryTab} ${deliveryType === "cdek-courier" ? styles.deliveryTabActive : ""}`}
                onClick={() => {
                  setDeliveryType("cdek-courier");
                  setErrors((prev) => ({ ...prev, pvz: "", pickupStore: "", address: "", zip: "" }));
                }}
              >
                <span>Курьер СДЭК</span>
                <span className={styles.deliveryTabSub}>До двери</span>
              </button>

              <button
                type="button"
                role="tab"
                aria-selected={deliveryType === "pickup-store"}
                className={`${styles.deliveryTab} ${deliveryType === "pickup-store" ? styles.deliveryTabActive : ""}`}
                onClick={() => {
                  setDeliveryType("pickup-store");
                  setErrors((prev) => ({ ...prev, pvz: "", pickupStore: "", address: "", zip: "" }));
                }}
              >
                <span>Самовывоз</span>
                <span className={styles.deliveryTabSub}>3 магазина в Москве</span>
              </button>
            </div>

            {/* Delivery Estimate Banner */}
            <div className={styles.deliveryEstimateBanner}>
              <div className={styles.deliveryEstimateInfo}>
                <span className={styles.deliveryEstimateTimeline}>
                  {deliveryType === "pickup-store"
                    ? "Готов к выдаче сегодня или завтра"
                    : `Срок доставки: ${activeEstimate ? `${activeEstimate.periodMin}–${activeEstimate.periodMax} дн.` : "1–3 дня"}`}
                </span>
                <span className={styles.deliveryEstimateSub}>
                  {deliveryType === "pickup-store"
                    ? "Резерв в магазине на 3 дня"
                    : `Отправка из Москвы · ${deliveryCity || "Россия"}`}
                </span>
              </div>
              <span className={styles.deliveryEstimatePrice}>Бесплатно</span>
            </div>

            {/* ── Mode 1: CDEK PVZ ── */}
            {deliveryType === "cdek-pvz" && (
              <div>
                {/* City with Autocomplete */}
                <div className={styles.formGroup}>
                  <label className={styles.formLabel}>Город получения *</label>
                  <div className={styles.cityWrapper} ref={cityWrapperRef}>
                    <input
                      name="city"
                      required
                      autoComplete="off"
                      className={`${styles.formInput}${errors.city ? ` ${styles.formInputError}` : ""}`}
                      placeholder="Начните вводить город (напр. Москва, Санкт-Петербург)"
                      value={deliveryCity}
                      onChange={handleCityChange}
                      onFocus={() => {
                        if (citySuggestions.length > 0) setShowCityDropdown(true);
                      }}
                    />
                    {showCityDropdown && citySuggestions.length > 0 && (
                      <div className={styles.cityDropdown}>
                        {citySuggestions.map((city) => (
                          <div
                            key={city.code}
                            className={styles.cityOption}
                            onClick={() => handleSelectCity(city)}
                          >
                            <span>{city.city}</span>
                            {city.region && <span className={styles.cityOptionRegion}>{city.region}</span>}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  {errors.city && <span className={styles.fieldError}>{errors.city}</span>}
                </div>

                {/* Selected PVZ Summary or PVZ Picker */}
                {selectedPvz && !isPvzPickerOpen ? (
                  <div className={styles.selectedPvzSummary}>
                    <div className={styles.selectedPvzInfo}>
                      <div className={styles.selectedPvzLabel}>Выбранный пункт выдачи:</div>
                      <strong>{selectedPvz.name}</strong> ({selectedPvz.location.address})
                      <div className={styles.pvzMeta} style={{ marginTop: 4 }}>
                        {selectedPvz.nearest_metro_station && (
                          <span className={styles.pvzMetro}>
                            <span className={styles.metroDot} />
                            м. {selectedPvz.nearest_metro_station}
                          </span>
                        )}
                        <span className={styles.pvzHours}>{selectedPvz.work_time}</span>
                      </div>
                    </div>
                    <button
                      type="button"
                      className={styles.changePvzBtn}
                      onClick={() => setIsPvzPickerOpen(true)}
                    >
                      Изменить
                    </button>
                  </div>
                ) : (
                  <div className={styles.pvzContainer}>
                    <div className={styles.pvzHeader}>
                      <input
                        type="text"
                        className={styles.pvzSearchInput}
                        placeholder="Поиск по адресу, метро или коду ПВЗ..."
                        value={pvzSearchQuery}
                        onChange={(e) => setPvzSearchQuery(e.target.value)}
                      />
                    </div>
                    <div className={styles.pvzList}>
                      {isLoadingPvz ? (
                        <div className={styles.pvzEmpty}>Загружаем пункты выдачи СДЭК…</div>
                      ) : filteredPvz.length === 0 ? (
                        <div className={styles.pvzEmpty}>
                          {pvzList.length === 0
                            ? "В этом городе нет доступных пунктов СДЭК. Выберите курьерскую доставку."
                            : "Ничего не найдено по вашему запросу."}
                        </div>
                      ) : (
                        filteredPvz.map((pvz) => {
                          const isSelected = selectedPvz?.code === pvz.code;
                          return (
                            <div
                              key={pvz.code}
                              className={`${styles.pvzItem} ${isSelected ? styles.pvzItemActive : ""}`}
                              onClick={() => {
                                setSelectedPvz(pvz);
                                setIsPvzPickerOpen(false);
                                setErrors((prev) => ({ ...prev, pvz: "" }));
                              }}
                            >
                              <div className={styles.pvzItemTop}>
                                <span className={styles.pvzAddress}>{pvz.location.address}</span>
                                <span
                                  className={`${styles.pvzBadge} ${
                                    pvz.type === "POSTAMAT" ? styles.pvzBadgePostamat : ""
                                  }`}
                                >
                                  {pvz.type === "POSTAMAT" ? "Постамат" : "ПВЗ"}
                                </span>
                              </div>
                              <div className={styles.pvzMeta}>
                                {pvz.nearest_metro_station && (
                                  <span className={styles.pvzMetro}>
                                    <span className={styles.metroDot} />
                                    м. {pvz.nearest_metro_station}
                                  </span>
                                )}
                                <span className={styles.pvzHours}>{pvz.work_time}</span>
                                {pvz.note && <span>· {pvz.note}</span>}
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                )}
                {errors.pvz && <span className={styles.fieldError}>{errors.pvz}</span>}
              </div>
            )}

            {/* ── Mode 2: CDEK Courier ── */}
            {deliveryType === "cdek-courier" && (
              <div>
                <div className={styles.formRow}>
                  <div className={styles.formGroup}>
                    <label className={styles.formLabel}>Город *</label>
                    <div className={styles.cityWrapper} ref={cityWrapperRef}>
                      <input
                        name="city"
                        required
                        autoComplete="off"
                        className={`${styles.formInput}${errors.city ? ` ${styles.formInputError}` : ""}`}
                        placeholder="Москва"
                        value={deliveryCity}
                        onChange={handleCityChange}
                        onFocus={() => {
                          if (citySuggestions.length > 0) setShowCityDropdown(true);
                        }}
                      />
                      {showCityDropdown && citySuggestions.length > 0 && (
                        <div className={styles.cityDropdown}>
                          {citySuggestions.map((city) => (
                            <div
                              key={city.code}
                              className={styles.cityOption}
                              onClick={() => handleSelectCity(city)}
                            >
                              <span>{city.city}</span>
                              {city.region && <span className={styles.cityOptionRegion}>{city.region}</span>}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
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
                  <label className={styles.formLabel}>Улица, дом, корпус *</label>
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
              </div>
            )}

            {/* ── Mode 3: Retail Store Pickup ── */}
            {deliveryType === "pickup-store" && (
              <div>
                <p className={styles.deliverySub} style={{ marginBottom: 12 }}>
                  Выберите фирменный магазин Mario Mikke в Москве для бесплатной примерки и получения:
                </p>
                <div className={styles.pickupStoresGrid}>
                  {MARIO_MIKKE_PICKUP_STORES.map((store) => {
                    const isSelected = selectedStoreId === store.id;
                    return (
                      <div
                        key={store.id}
                        className={`${styles.pickupStoreCard} ${
                          isSelected ? styles.pickupStoreCardActive : ""
                        }`}
                        onClick={() => {
                          setSelectedStoreId(store.id);
                          setErrors((prev) => ({ ...prev, pickupStore: "" }));
                        }}
                      >
                        <div className={styles.pickupStoreTitle}>
                          <span>{store.name}</span>
                          <input
                            type="radio"
                            name="pickupStore"
                            checked={isSelected}
                            onChange={() => setSelectedStoreId(store.id)}
                            style={{ accentColor: "var(--text-primary)" }}
                          />
                        </div>
                        <div className={styles.pickupStoreAddress}>{store.address}</div>
                        <div className={styles.pickupStoreMeta}>
                          <span className={styles.pvzMetro}>
                            <span className={styles.metroDot} />
                            {store.metro}
                          </span>
                          <span>{store.workHours}</span>
                          <span>{store.phone}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
                {errors.pickupStore && <span className={styles.fieldError}>{errors.pickupStore}</span>}
              </div>
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

            <div className={styles.paymentTrustBlock}>
              <p className={styles.paymentTrustMethods}>МИР · СБП · Visa · Mastercard</p>
              <p className={styles.paymentTrustText}>
                Безопасная онлайн-оплата через платёжный шлюз Т-Банка · 3D-Secure
              </p>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
