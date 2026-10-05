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
  searchCdekCities,
  fetchCdekDeliveryPoints,
  MARIO_MIKKE_PICKUP_STORES,
} from "../../lib/cdek";
import {
  type PochtaPostOffice,
  fetchPostOffices,
} from "../../lib/pochta";
import {
  type YandexCity,
  type YandexDeliveryPoint,
  searchYandexCities,
  fetchYandexDeliveryPoints,
} from "../../lib/yandex-delivery";
import { DEFAULT_RECOMMENDATION_SIZE, findAddableVariant, selectableSizes } from "../../lib/shop";
import styles from "./checkout.module.css";

export type DeliveryType =
  | "yandex-pvz"
  | "cdek-pvz"
  | "cdek-courier"
  | "pickup-store"
  | "pochta-parcel"
  | "pochta-courier"
  | "own-courier-mkad";

const DELIVERY_MODES = [
  { type: "yandex-pvz", label: "Яндекс Маркет", subtitle: "ПВЗ и постаматы" },
  { type: "cdek-pvz", label: "СДЭК ПВЗ", subtitle: "Пункт или постамат" },
  { type: "cdek-courier", label: "СДЭК Курьер", subtitle: "До двери" },
  { type: "pochta-parcel", label: "Почта РФ", subtitle: "В отделение" },
  { type: "pochta-courier", label: "Почта Курьер", subtitle: "Курьер EMS" },
  { type: "own-courier-mkad", label: "Курьер по Москве", subtitle: "Внутри МКАД" },
  { type: "pickup-store", label: "Самовывоз", subtitle: "3 бутика в Москве" },
] as const satisfies readonly { readonly type: DeliveryType; readonly label: string; readonly subtitle: string }[];

function findShippingOption(
  deliveryType: DeliveryType,
  shippingOptions: readonly MedusaShippingOption[] | null,
): MedusaShippingOption | undefined {
  return shippingOptions?.find((option) => option.type?.code === deliveryType);
}

function firstAvailableDeliveryType(
  shippingOptions: readonly MedusaShippingOption[] | null,
): DeliveryType | undefined {
  return DELIVERY_MODES.find((mode) => findShippingOption(mode.type, shippingOptions))?.type;
}

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
  selectedPochtaOffice: PochtaPostOffice | null,
  cdekCityCode: number | null,
  selectedYandexPvz: YandexDeliveryPoint | null,
  yandexDeliveryCity: string,
  yandexGeoId: number | null,
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

  if (deliveryType === "yandex-pvz") {
    if (!yandexDeliveryCity.trim() || yandexGeoId === null) {
      errors.yandexCity = "Выберите город из списка";
    }
    if (!selectedYandexPvz) {
      errors.yandexPvz = "Выберите пункт выдачи Яндекс Маркет";
    }
  } else if (deliveryType === "cdek-pvz") {
    if (!deliveryCity.trim()) {
      errors.city = "Введите город получения";
    }
    if (cdekCityCode === null) {
      errors.city = "Выберите город из списка";
    }
    if (!selectedPvz) {
      errors.pvz = "Выберите пункт выдачи СДЭК";
    }
  } else if (deliveryType === "cdek-courier") {
    if (!deliveryCity.trim()) {
      errors.city = "Введите город доставки";
    }
    if (cdekCityCode === null) {
      errors.city = "Выберите город из списка";
    }
    if (!form.address.trim()) {
      errors.address = "Введите улицу и дом";
    }
    if (!form.zip.trim()) {
      errors.zip = "Введите индекс";
    } else if (!/^\d{6}$/.test(form.zip)) {
      errors.zip = "Индекс: 6 цифр";
    }
  } else if (deliveryType === "pochta-parcel") {
    if (!/^\d{6}$/.test(form.zip)) {
      errors.zip = "Введите индекс из 6 цифр";
    }
    if (!selectedPochtaOffice?.settlement && !form.city.trim()) {
      errors.city = "Укажите город выбранного отделения";
    }
    if (!selectedPochtaOffice || selectedPochtaOffice.isClosed) {
      errors.pochtaOffice = "Выберите почтовое отделение связи";
    }
  } else if (deliveryType === "pochta-courier") {
    if (!form.city.trim()) {
      errors.city = "Введите город доставки";
    }
    if (!form.address.trim()) {
      errors.address = "Введите улицу и дом";
    }
    if (!form.zip.trim()) {
      errors.zip = "Введите индекс";
    } else if (!/^\d{6}$/.test(form.zip)) {
      errors.zip = "Индекс: 6 цифр";
    }
  } else if (deliveryType === "own-courier-mkad") {
    if (!form.city.trim()) {
      errors.city = "Введите город доставки";
    }
    if (!form.address.trim()) {
      errors.address = "Введите улицу и дом";
    }
    if (!form.zip.trim()) {
      errors.zip = "Введите индекс";
    } else if (!/^\d{6}$/.test(form.zip)) {
      errors.zip = "Индекс: 6 цифр";
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
      return /^\d{6}$/.test(value) ? "" : "Индекс: 6 цифр";
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
    checkOwnCourierAvailability,
    prepareCheckout,
    updateQuantity,
    removeFromCart,
  } = useCart();

  // Способы доставки Medusa
  const [shippingOptions, setShippingOptions] = useState<MedusaShippingOption[] | null>(null);
  const [shippingOptionsFailed, setShippingOptionsFailed] = useState(false);
  const [isCheckingOwnCourier, setIsCheckingOwnCourier] = useState(false);
  const [ownCourierMessage, setOwnCourierMessage] = useState("");
  const ownCourierRequestRef = useRef(0);
  const [hasConsented, setHasConsented] = useState(false);

  // Delivery module state
  const [deliveryType, setDeliveryType] = useState<DeliveryType>("yandex-pvz");
  const [deliveryCity, setDeliveryCity] = useState("Москва");
  const [cdekCityCode, setCdekCityCode] = useState<number | null>(44);
  const [citySuggestions, setCitySuggestions] = useState<CdekCity[]>([]);
  const [showCityDropdown, setShowCityDropdown] = useState(false);
  const citySearchTimeout = useRef<NodeJS.Timeout | null>(null);
  const cdekCitySearchRequestRef = useRef(0);
  const cityWrapperRef = useRef<HTMLDivElement>(null);

  // Yandex Delivery PVZ state
  const [yandexDeliveryCity, setYandexDeliveryCity] = useState("");
  const [yandexGeoId, setYandexGeoId] = useState<number | null>(null);
  const [yandexCitySuggestions, setYandexCitySuggestions] = useState<YandexCity[]>([]);
  const [showYandexCityDropdown, setShowYandexCityDropdown] = useState(false);
  const yandexCitySearchTimeout = useRef<NodeJS.Timeout | null>(null);
  const yandexCitySearchRequestRef = useRef(0);
  const yandexPvzRequestRef = useRef(0);
  const yandexCityWrapperRef = useRef<HTMLDivElement>(null);
  const [selectedYandexCity, setSelectedYandexCity] = useState<YandexCity | null>(null);
  const [yandexCitySearchFailed, setYandexCitySearchFailed] = useState(false);
  const [yandexPvzList, setYandexPvzList] = useState<YandexDeliveryPoint[]>([]);
  const [loadedYandexGeoId, setLoadedYandexGeoId] = useState<number | null>(null);
  const [isLoadingYandexPvz, setIsLoadingYandexPvz] = useState(false);
  const [yandexPvzFailed, setYandexPvzFailed] = useState(false);
  const [selectedYandexPvz, setSelectedYandexPvz] = useState<YandexDeliveryPoint | null>(null);
  const [yandexPvzSearchQuery, setYandexPvzSearchQuery] = useState("");
  const [isYandexPvzPickerOpen, setIsYandexPvzPickerOpen] = useState(false);

  // PVZ state
  const [pvzList, setPvzList] = useState<CdekDeliveryPoint[]>([]);
  const [isLoadingPvz, setIsLoadingPvz] = useState(true);
  const [selectedPvz, setSelectedPvz] = useState<CdekDeliveryPoint | null>(null);
  const [pvzSearchQuery, setPvzSearchQuery] = useState("");
  const [isPvzPickerOpen, setIsPvzPickerOpen] = useState(false);

  // Russian Post state
  const [pochtaOffices, setPochtaOffices] = useState<PochtaPostOffice[]>([]);
  const [isLoadingPochta, setIsLoadingPochta] = useState(false);
  const [selectedPochtaOffice, setSelectedPochtaOffice] = useState<PochtaPostOffice | null>(null);
  const [pochtaSearchQuery, setPochtaSearchQuery] = useState("");
  const [isPochtaPickerOpen, setIsPochtaPickerOpen] = useState(false);

  // Pickup Store state
  const [selectedStoreId, setSelectedStoreId] = useState(MARIO_MIKKE_PICKUP_STORES[0].id);

  const [form, setForm] = useState<FormFields>({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    city: "Москва",
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

  const availableDeliveryModes = shippingOptions
    ? DELIVERY_MODES.filter((mode) => findShippingOption(mode.type, shippingOptions))
    : [];
  const selectedShippingOption = findShippingOption(deliveryType, shippingOptions);
  const effectiveShippingOptionId = selectedShippingOption?.id ?? "";
  const deliveryPrice = typeof selectedShippingOption?.amount === "number" && Number.isFinite(selectedShippingOption.amount) && selectedShippingOption.amount >= 0
    ? formatPrice(selectedShippingOption.amount)
    : "Стоимость уточняется";
  const isDeliveryUnavailable = !effectiveShippingOptionId;

  useEffect(() => {
    if (!needsShippingOptions) return;

    let isActive = true;
    getShippingOptions()
      .then((options) => {
        if (!isActive) return;
        setDeliveryType((current) =>
          findShippingOption(current, options) ? current : firstAvailableDeliveryType(options) ?? current,
        );
        setShippingOptions(options);
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


  // Click outside to close city dropdown
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (cityWrapperRef.current && !cityWrapperRef.current.contains(event.target as Node)) {
        setShowCityDropdown(false);
      }
      if (yandexCityWrapperRef.current && !yandexCityWrapperRef.current.contains(event.target as Node)) {
        setShowYandexCityDropdown(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Only an explicitly selected city can load points. Discard responses from earlier cities.
  useEffect(() => {
    const requestId = ++yandexPvzRequestRef.current;
    if (deliveryType !== "yandex-pvz" || !findShippingOption(deliveryType, shippingOptions) || yandexGeoId === null) {
      return;
    }
    let active = true;
    fetchYandexDeliveryPoints({ geo_id: yandexGeoId })
      .then((points) => {
        if (!active || requestId !== yandexPvzRequestRef.current) return;
        setYandexPvzList(points);
        setLoadedYandexGeoId(yandexGeoId);
      })
      .catch((error: unknown) => {
        if (!active || requestId !== yandexPvzRequestRef.current) return;
        console.warn("Failed to fetch Yandex PVZ", error);
        setYandexPvzFailed(true);
      })
      .finally(() => {
        if (active && requestId === yandexPvzRequestRef.current) setIsLoadingYandexPvz(false);
      });
    return () => {
      active = false;
    };
  }, [yandexGeoId, deliveryType, shippingOptions]);

  // Fetch PVZ list when city or mode changes
  useEffect(() => {
    if (deliveryType !== "cdek-pvz" || cdekCityCode === null || !findShippingOption(deliveryType, shippingOptions)) {
      return;
    }
    let active = true;
    fetchCdekDeliveryPoints(cdekCityCode)
      .then((points) => {
        if (!active) return;
        setPvzList(points);
      })
      .catch((error: unknown) => {
        if (!active) return;
        console.warn("Failed to fetch PVZ", error);
        setPvzList([]);
        setSelectedPvz(null);
      })
      .finally(() => {
        if (active) setIsLoadingPvz(false);
      });
    return () => {
      active = false;
    };
  }, [cdekCityCode, deliveryType, shippingOptions]);

  // Fetch Russian Post offices when mode or zip changes
  useEffect(() => {
    if (deliveryType !== "pochta-parcel" || !/^\d{6}$/.test(form.zip)) return;
    let active = true;
    fetchPostOffices(form.zip)
      .then((offices) => {
        if (!active) return;
        setPochtaOffices(offices.filter((office) => !office.isClosed));
      })
      .catch(() => {
        if (!active) return;
        setPochtaOffices([]);
        setSelectedPochtaOffice(null);
      })
      .finally(() => {
        if (active) setIsLoadingPochta(false);
      });
    return () => {
      active = false;
    };
  }, [form.zip, deliveryType]);

  useEffect(() => {
    const resetSubmission = () => {
      isSubmittingRef.current = false;
      setIsSubmitting(false);
    };
    window.addEventListener("pageshow", resetSubmission);
    return () => window.removeEventListener("pageshow", resetSubmission);
  }, []);

  const invalidateOwnCourierAvailability = () => {
    ownCourierRequestRef.current += 1;
    setIsCheckingOwnCourier(false);
    if (shippingOptions?.some((option) => option.type?.code === "own-courier-mkad")) {
      const remainingOptions = shippingOptions.filter((option) => option.type?.code !== "own-courier-mkad");
      setShippingOptions(remainingOptions);
      if (deliveryType === "own-courier-mkad") {
        setDeliveryType(firstAvailableDeliveryType(remainingOptions) ?? deliveryType);
      }
    }
    setOwnCourierMessage("");
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setForm((prev) => ({
      ...prev,
      [name]: value,
      ...(name === "zip" && deliveryType === "pochta-parcel" ? { city: "" } : {}),
    }));
    if (name === "zip" && deliveryType === "pochta-parcel") {
      setPochtaOffices([]);
      setSelectedPochtaOffice(null);
      setIsLoadingPochta(/^\d{6}$/.test(value));
      setIsPochtaPickerOpen(true);
    }
    if (name === "city" || name === "address" || name === "zip" || name === "apartment") {
      invalidateOwnCourierAvailability();
    }
    if (errors[name]) {
      setErrors((prev) => ({ ...prev, [name]: "" }));
    }
  };

  const handleCityChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    ++cdekCitySearchRequestRef.current;
    setDeliveryCity(value);
    setForm((prev) => ({ ...prev, city: value }));
    invalidateOwnCourierAvailability();
    setCdekCityCode(null);
    setCitySuggestions([]);
    setPvzList([]);
    setIsLoadingPvz(false);
    setSelectedPvz(null);
    setIsPvzPickerOpen(false);
    if (errors.city) {
      setErrors((prev) => ({ ...prev, city: "" }));
    }

    if (citySearchTimeout.current) {
      clearTimeout(citySearchTimeout.current);
    }

    if (value.trim().length >= 2) {
      const requestId = cdekCitySearchRequestRef.current;
      citySearchTimeout.current = setTimeout(async () => {
        try {
          const results = await searchCdekCities(value);
          if (requestId !== cdekCitySearchRequestRef.current) return;
          setCitySuggestions(results);
          setShowCityDropdown(results.length > 0);
        } catch {
          if (requestId !== cdekCitySearchRequestRef.current) return;
          setCitySuggestions([]);
        }
      }, 250);
    } else {
      setShowCityDropdown(false);
    }
  };

  const checkOwnCourier = async () => {
    const addressErrors: FormErrors = {};
    if (!form.city.trim()) addressErrors.city = "Введите город доставки";
    if (!form.address.trim()) addressErrors.address = "Введите улицу и дом";
    if (!/^\d{6}$/.test(form.zip)) addressErrors.zip = "Введите индекс из 6 цифр";
    if (Object.keys(addressErrors).length > 0) {
      setErrors((previous) => ({ ...previous, ...addressErrors }));
      return;
    }

    const requestId = ++ownCourierRequestRef.current;
    setIsCheckingOwnCourier(true);
    setOwnCourierMessage("");
    try {
      const options = await checkOwnCourierAvailability({
        city: form.city.trim(), address: form.address.trim(), apartment: form.apartment.trim(), zip: form.zip.trim(),
      });
      if (requestId !== ownCourierRequestRef.current) return;
      setDeliveryType((current) =>
        findShippingOption(current, options) ? current : firstAvailableDeliveryType(options) ?? current,
      );
      setShippingOptions(options);
      if (!findShippingOption("own-courier-mkad", options)) {
        setOwnCourierMessage("Курьерская доставка по этому адресу недоступна.");
      }
    } catch (error) {
      if (requestId === ownCourierRequestRef.current) {
        setOwnCourierMessage(error instanceof Error ? error.message : "Не удалось проверить доставку курьером.");
      }
    } finally {
      if (requestId === ownCourierRequestRef.current) setIsCheckingOwnCourier(false);
    }
  };

  const handleSelectCity = (city: CdekCity) => {
    ++cdekCitySearchRequestRef.current;
    clearTimeout(citySearchTimeout.current ?? undefined);
    setDeliveryCity(city.city);
    setCdekCityCode(city.code);
    setForm((prev) => ({ ...prev, city: city.city }));
    invalidateOwnCourierAvailability();
    setShowCityDropdown(false);
    setCitySuggestions([]);
    setPvzList([]);
    setIsLoadingPvz(true);
    setIsPvzPickerOpen(true);
    setSelectedPvz(null);
    setErrors((prev) => ({ ...prev, city: "" }));
  };

  const handleYandexCityChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    ++yandexCitySearchRequestRef.current;
    ++yandexPvzRequestRef.current;
    setSelectedYandexCity(null);
    setYandexDeliveryCity(value);
    setYandexGeoId(null);
    setYandexCitySuggestions([]);
    setShowYandexCityDropdown(false);
    setYandexCitySearchFailed(false);
    setYandexPvzList([]);
    setLoadedYandexGeoId(null);
    setSelectedYandexPvz(null);
    setYandexPvzFailed(false);
    setIsLoadingYandexPvz(false);
    setIsYandexPvzPickerOpen(false);
    setYandexPvzSearchQuery("");
    setErrors((prev) => ({ ...prev, yandexCity: "", yandexPvz: "" }));

    clearTimeout(yandexCitySearchTimeout.current ?? undefined);
    if (value.trim().length >= 2) {
      const requestId = yandexCitySearchRequestRef.current;
      yandexCitySearchTimeout.current = setTimeout(async () => {
        try {
          const results = await searchYandexCities(value);
          if (requestId !== yandexCitySearchRequestRef.current) return;
          setYandexCitySuggestions(results);
          setShowYandexCityDropdown(results.length > 0);
        } catch {
          if (requestId !== yandexCitySearchRequestRef.current) return;
          setYandexCitySuggestions([]);
          setYandexCitySearchFailed(true);
        }
      }, 250);
    }
  };

  const handleSelectYandexCity = (city: YandexCity) => {
    ++yandexCitySearchRequestRef.current;
    ++yandexPvzRequestRef.current;
    setSelectedYandexCity(city);
    clearTimeout(yandexCitySearchTimeout.current ?? undefined);
    setYandexDeliveryCity(city.city);
    setYandexGeoId(city.geo_id);
    setYandexCitySuggestions([]);
    setShowYandexCityDropdown(false);
    setYandexCitySearchFailed(false);
    setIsYandexPvzPickerOpen(true);
    setYandexPvzList([]);
    setLoadedYandexGeoId(null);
    setSelectedYandexPvz(null);
    setYandexPvzFailed(false);
    setIsLoadingYandexPvz(true);
    setErrors((prev) => ({ ...prev, yandexCity: "", yandexPvz: "" }));
  };

  const handleBlur = (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    const error = validateField(name as keyof FormFields, value);
    setErrors((prev) => ({ ...prev, [name]: error }));
  };


  const validYandexPvz = deliveryType === "yandex-pvz" &&
    selectedYandexCity?.geo_id === yandexGeoId &&
    selectedYandexCity?.city === yandexDeliveryCity &&
    yandexGeoId !== null && loadedYandexGeoId === yandexGeoId &&
    !isLoadingYandexPvz && !yandexPvzFailed &&
    selectedYandexPvz && yandexPvzList.includes(selectedYandexPvz)
    ? selectedYandexPvz : null;
  const filteredYandexPvz = yandexPvzList.filter((p) => {
    const q = yandexPvzSearchQuery.trim().toLowerCase();
    if (!q) return true;
    return (
      p.location.address.toLowerCase().includes(q) ||
      p.name.toLowerCase().includes(q) ||
      p.id.toLowerCase().includes(q)
    );
  });

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

  const filteredPochtaOffices = pochtaOffices.filter((o) => {
    if (o.isClosed) return false;
    const q = pochtaSearchQuery.trim().toLowerCase();
    if (!q) return true;
    return (
      o.postalCode.includes(q) ||
      o.addressSource.toLowerCase().includes(q) ||
      (o.settlement && o.settlement.toLowerCase().includes(q))
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
      selectedPochtaOffice,
      cdekCityCode,
      validYandexPvz,
      yandexDeliveryCity,
      yandexGeoId,
    );

    if (deliveryType === "pochta-parcel" &&
        (isLoadingPochta || !selectedPochtaOffice || !pochtaOffices.includes(selectedPochtaOffice))) {
      newErrors.pochtaOffice = "Выберите почтовое отделение связи";
    }
    if (!effectiveShippingOptionId) {
      newErrors.shippingOption = "Этот способ доставки сейчас недоступен. Выберите доступный вариант.";
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

    let finalCity = deliveryCity.trim() || form.city.trim();
    let finalAddress = form.address.trim();
    let finalZip = form.zip.trim();
    let cdekPvzCode: string | undefined;
    let cdekPvzAddress: string | undefined;
    let pickupStoreId: string | undefined;
    let pickupStoreName: string | undefined;
    let pochtaOfficeIndex: string | undefined;
    let pochtaOfficeAddress: string | undefined;
    let yandexPvzId: string | undefined;
    let yandexPvzName: string | undefined;
    let yandexPvzAddress: string | undefined;

    if (deliveryType === "yandex-pvz") {
      finalCity = yandexDeliveryCity.trim();
      finalAddress = validYandexPvz!.location.address;
      finalZip = "";
      yandexPvzId = validYandexPvz!.id;
      yandexPvzName = validYandexPvz!.name;
      yandexPvzAddress = validYandexPvz!.location.address;
    } else if (deliveryType === "cdek-pvz") {
      finalCity = deliveryCity.trim() || "Москва";
      finalAddress = selectedPvz ? selectedPvz.location.address : form.address.trim();
      finalZip = "";
      cdekPvzCode = selectedPvz?.code;
      cdekPvzAddress = selectedPvz ? `${selectedPvz.name}, ${selectedPvz.location.address}` : undefined;
    } else if (deliveryType === "cdek-courier") {
      finalCity = deliveryCity.trim();
      finalAddress = form.address.trim();
      finalZip = form.zip.trim();
    } else if (deliveryType === "pochta-parcel") {
      finalCity = selectedPochtaOffice?.settlement || form.city.trim();
      finalAddress = selectedPochtaOffice ? selectedPochtaOffice.addressSource : form.address.trim();
      finalZip = selectedPochtaOffice ? selectedPochtaOffice.postalCode : form.zip.trim();
      pochtaOfficeIndex = selectedPochtaOffice?.postalCode;
      pochtaOfficeAddress = selectedPochtaOffice?.addressSource;
    } else if (deliveryType === "pochta-courier") {
      finalCity = form.city.trim();
      finalAddress = form.address.trim();
      finalZip = form.zip.trim();
    } else if (deliveryType === "own-courier-mkad") {
      finalCity = form.city.trim();
      finalAddress = form.address.trim();
      finalZip = form.zip.trim();
    } else if (deliveryType === "pickup-store") {
      const store = MARIO_MIKKE_PICKUP_STORES.find((candidate) => candidate.id === selectedStoreId);
      if (!store) {
        setErrors({ ...newErrors, pickupStore: "Выберите магазин для самовывоза" });
        return;
      }
      finalCity = "Москва";
      finalAddress = `${store.name}, ${store.address}`;
      finalZip = "";
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
      apartment: (deliveryType === "cdek-courier" || deliveryType === "pochta-courier" || deliveryType === "own-courier-mkad") ? form.apartment.trim() : "",
      zip: finalZip,
      shippingOptionId: effectiveShippingOptionId,
      comment: form.comment,
      deliveryType,
      cdekPvzCode,
      cdekPvzAddress,
      ...(
        (deliveryType === "cdek-pvz" || deliveryType === "cdek-courier") && cdekCityCode !== null
          ? { cdekCityCode }
          : {}
      ),
      pickupStoreId,
      pickupStoreName,
      pochtaOfficeIndex,
      pochtaOfficeAddress,
      yandexPvzId,
      yandexPvzName,
      yandexPvzAddress,
      ...(
        deliveryType === "yandex-pvz" && yandexGeoId !== null
          ? { yandexGeoId }
          : {}
      ),
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
          Номер заказа: №{orderId}. Мы отправили подтверждение на {form.email} и
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
                Не удалось загрузить доступные способы доставки. Оформление заказа временно недоступно.
              </p>
            )}

            {/* Delivery Tabs */}
            {shippingOptions === null ? (
              <p className={styles.deliverySub}>Загружаем доступные способы доставки…</p>
            ) : availableDeliveryModes.length === 0 ? (
              <p className={styles.fieldError} role="alert">
                Для этой корзины сейчас нет доступных способов доставки. Попробуйте позже.
              </p>
            ) : (
              <div className={styles.deliveryTabs} role="tablist">
                {availableDeliveryModes.map((mode) => (
                  <button
                    key={mode.type}
                    type="button"
                    role="tab"
                    aria-selected={deliveryType === mode.type}
                    className={`${styles.deliveryTab} ${deliveryType === mode.type ? styles.deliveryTabActive : ""}`}
                    onClick={() => {
                      if (deliveryType === mode.type) return;
                      setDeliveryType(mode.type);
                      ++cdekCitySearchRequestRef.current;
                      clearTimeout(citySearchTimeout.current ?? undefined);
                      setCitySuggestions([]);
                      setShowCityDropdown(false);
                      setPvzList([]);
                      setSelectedPvz(null);
                      setIsLoadingPvz(mode.type === "cdek-pvz" && cdekCityCode !== null);
                      setPochtaOffices([]);
                      setSelectedPochtaOffice(null);
                      setIsPochtaPickerOpen(true);
                      setIsLoadingPochta(mode.type === "pochta-parcel" && /^\d{6}$/.test(form.zip));
                      if (mode.type === "pochta-parcel") setForm((prev) => ({ ...prev, city: "" }));
                      ++yandexPvzRequestRef.current;
                      setYandexPvzList([]);
                      setLoadedYandexGeoId(null);
                      setSelectedYandexPvz(null);
                      setYandexPvzFailed(false);
                      setIsLoadingYandexPvz(mode.type === "yandex-pvz" && yandexGeoId !== null);
                      setErrors((prev) => ({
                        ...prev,
                        pvz: "",
                        yandexPvz: "",
                        yandexCity: "",
                        pochtaOffice: "",
                        address: "",
                        zip: "",
                      }));
                    }}
                  >
                    <span>{mode.label}</span>
                    <span className={styles.deliveryTabSub}>{mode.subtitle}</span>
                  </button>
                ))}
              </div>
            )}

            {shippingOptions !== null && !findShippingOption("own-courier-mkad", shippingOptions) && (
              <div className={styles.deliveryEstimateBanner}>
                <div className={styles.deliveryEstimateInfo}>
                  <span className={styles.deliveryEstimateTimeline}>Курьер по Москве</span>
                  <span className={styles.deliveryEstimateSub}>Укажите адрес, чтобы проверить доступность внутри МКАД.</span>
                </div>
                <div>
                  <div className={styles.formRow}>
                    <input name="city" className={styles.formInput} placeholder="Город" value={form.city} onChange={handleChange} />
                    <input name="zip" className={styles.formInput} placeholder="Индекс" value={form.zip} onChange={handleChange} />
                  </div>
                  <input name="address" className={styles.formInput} placeholder="Улица, дом" value={form.address} onChange={handleChange} />
                  <button type="button" className={styles.changePvzBtn} onClick={checkOwnCourier} disabled={isCheckingOwnCourier}>
                    {isCheckingOwnCourier ? "Проверяем..." : "Проверить доставку курьером"}
                  </button>
                  {ownCourierMessage && <span className={styles.fieldError} role="alert">{ownCourierMessage}</span>}
                </div>
              </div>
            )}

            {selectedShippingOption && (
              <div className={styles.deliveryEstimateBanner}>
                <div className={styles.deliveryEstimateInfo}>
                  <span className={styles.deliveryEstimateTimeline}>
                    {deliveryType === "pickup-store"
                      ? "Готовность к выдаче подтвердим после обработки заказа"
                      : "Срок доставки уточняется"}
                  </span>
                  <span className={styles.deliveryEstimateSub}>
                    {deliveryType === "pickup-store"
                      ? "Условия резерва подтвердим после обработки заказа"
                      : "Срок доставки будет подтверждён после оформления"}
                  </span>
                </div>
                <span className={styles.deliveryEstimatePrice}>
                  {deliveryPrice}
                </span>
              </div>
            )}

            {/* ── Mode 0: Yandex Market PVZ ── */}
            {deliveryType === "yandex-pvz" && selectedShippingOption && (
              <div>
                {/* City with Autocomplete */}
                <div className={styles.formGroup}>
                  <label className={styles.formLabel}>Город получения *</label>
                  <div className={styles.cityWrapper} ref={yandexCityWrapperRef}>
                    <input
                      name="yandexCity"
                      required
                      autoComplete="off"
                      className={`${styles.formInput}${errors.yandexCity ? ` ${styles.formInputError}` : ""}`}
                      placeholder="Начните вводить город (напр. Москва, Казань, Санкт-Петербург)"
                      value={yandexDeliveryCity}
                      onChange={handleYandexCityChange}
                      onFocus={() => {
                        if (yandexCitySuggestions.length > 0) setShowYandexCityDropdown(true);
                      }}
                    />
                    {showYandexCityDropdown && yandexCitySuggestions.length > 0 && (
                      <div className={styles.cityDropdown}>
                        {yandexCitySuggestions.map((c) => (
                          <div
                            key={c.geo_id}
                            role="button"
                            tabIndex={0}
                            className={styles.cityOption}
                            onClick={() => handleSelectYandexCity(c)}
                            onKeyDown={(event) => {
                              if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault();
                                handleSelectYandexCity(c);
                              }
                            }}
                          >
                            <span>{c.city}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  {yandexCitySearchFailed && (
                    <span className={styles.fieldError} role="alert">
                      Не удалось загрузить города Яндекс Маркет. Попробуйте ещё раз.
                    </span>
                  )}
                  {errors.yandexCity && <span className={styles.fieldError}>{errors.yandexCity}</span>}
                </div>

                {/* Selected PVZ Summary or PVZ Picker */}
                {validYandexPvz && !isYandexPvzPickerOpen ? (
                  <div className={styles.selectedPvzSummary}>
                    <div className={styles.selectedPvzInfo}>
                      <div className={styles.selectedPvzLabel}>Выбранный пункт Яндекс Маркет:</div>
                      <strong>{validYandexPvz.name}</strong> ({validYandexPvz.location.address})
                      <div className={styles.pvzMeta} style={{ marginTop: 4 }}>
                        {validYandexPvz.isFittingAllowed && (
                          <span className={`${styles.pvzBadge} ${styles.pvzBadgeFitting}`}>
                            Примерка доступна
                          </span>
                        )}
                        {validYandexPvz.phone && (
                          <span className={styles.pvzHours}>{validYandexPvz.phone}</span>
                        )}
                      </div>
                    </div>
                    <button
                      type="button"
                      className={styles.changePvzBtn}
                      onClick={() => setIsYandexPvzPickerOpen(true)}
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
                        placeholder="Поиск по адресу или названию ПВЗ..."
                        value={yandexPvzSearchQuery}
                        onChange={(e) => setYandexPvzSearchQuery(e.target.value)}
                      />
                    </div>
                    <div className={styles.pvzList}>
                      {isLoadingYandexPvz ? (
                        <div className={styles.pvzEmpty}>Загружаем пункты выдачи Яндекс Маркет…</div>
                      ) : yandexPvzFailed ? (
                        <div className={styles.pvzEmpty} role="alert">
                          Не удалось загрузить пункты выдачи Яндекс Маркет. Попробуйте выбрать город ещё раз.
                        </div>
                      ) : yandexGeoId === null ? (
                        <div className={styles.pvzEmpty}>Выберите город из списка, чтобы увидеть пункты выдачи.</div>
                      ) : loadedYandexGeoId !== yandexGeoId || filteredYandexPvz.length === 0 ? (
                        <div className={styles.pvzEmpty}>
                          {yandexPvzList.length === 0 || loadedYandexGeoId !== yandexGeoId
                            ? "В этом городе нет доступных пунктов выдачи Яндекс Маркет."
                            : "Ничего не найдено по вашему запросу."}
                        </div>
                      ) : (
                        filteredYandexPvz.map((pvz) => {
                          const isSelected = selectedYandexPvz?.id === pvz.id;
                          return (
                            <div
                              key={pvz.id}
                              role="button"
                              tabIndex={0}
                              className={`${styles.pvzItem} ${isSelected ? styles.pvzItemActive : ""}`}
                              onClick={() => {
                                setSelectedYandexPvz(pvz);
                                setIsYandexPvzPickerOpen(false);
                                setErrors((prev) => ({ ...prev, yandexPvz: "" }));
                              }}
                              onKeyDown={(event) => {
                                if (event.key === "Enter" || event.key === " ") {
                                  event.preventDefault();
                                  event.currentTarget.click();
                                }
                              }}
                            >
                              <div className={styles.pvzItemTop}>
                                <span className={styles.pvzAddress}>{pvz.location.address}</span>
                                <span
                                  className={`${styles.pvzBadge} ${
                                    pvz.type === "terminal" ? styles.pvzBadgePostamat : styles.pvzBadgeYandex
                                  }`}
                                >
                                  {pvz.type === "terminal" ? "Постамат" : "ПВЗ Яндекс"}
                                </span>
                              </div>
                              <div className={styles.pvzMeta}>
                                <span>{pvz.name}</span>
                                {pvz.isFittingAllowed && (
                                  <span className={`${styles.pvzBadge} ${styles.pvzBadgeFitting}`}>
                                    Примерка
                                  </span>
                                )}
                                {pvz.phone && <span className={styles.pvzHours}>{pvz.phone}</span>}
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                )}
                {errors.yandexPvz && <span className={styles.fieldError}>{errors.yandexPvz}</span>}
              </div>
            )}

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

            {deliveryType === "own-courier-mkad" && (
              <div>
                <div className={styles.formRow}>
                  <div className={styles.formGroup}>
                    <label className={styles.formLabel}>Город *</label>
                    <input
                      name="city"
                      required
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

            {/* ── Mode: Russian Post Parcel in Post Office ── */}
            {deliveryType === "pochta-parcel" && (
              <div>
                <div className={styles.formRow}>
                  <div className={styles.formGroup}>
                    <label className={styles.formLabel}>Почтовый индекс *</label>
                    <input
                      name="zip"
                      required
                      inputMode="numeric"
                      pattern="[0-9]{6}"
                      maxLength={6}
                      className={`${styles.formInput}${errors.zip ? ` ${styles.formInputError}` : ""}`}
                      placeholder="101000"
                      value={form.zip}
                      onChange={handleChange}
                      onBlur={handleBlur}
                    />
                    {errors.zip && <span className={styles.fieldError}>{errors.zip}</span>}
                  </div>
                  <div className={styles.formGroup}>
                    <label className={styles.formLabel}>Город / населённый пункт *</label>
                    <input
                      name="city"
                      className={`${styles.formInput}${errors.city ? ` ${styles.formInputError}` : ""}`}
                      placeholder="Москва"
                      value={form.city}
                      onChange={handleChange}
                    />
                    {errors.city && <span className={styles.fieldError}>{errors.city}</span>}
                  </div>
                </div>

                {selectedPochtaOffice && !isPochtaPickerOpen ? (
                  <div className={styles.selectedPvzSummary}>
                    <div className={styles.selectedPvzInfo}>
                      <div className={styles.selectedPvzLabel}>Выбранное отделение Почты России:</div>
                      <strong>Отделение {selectedPochtaOffice.postalCode}</strong>
                      <div>{selectedPochtaOffice.addressSource}</div>
                      <div className={styles.pvzMeta} style={{ marginTop: 4 }}>
                        <span className={styles.pvzHours}>{selectedPochtaOffice.workHours}</span>
                        {selectedPochtaOffice.isClosed && <span style={{ color: "var(--danger)" }}>Временно закрыто</span>}
                      </div>
                    </div>
                    <button
                      type="button"
                      className={styles.changePvzBtn}
                      onClick={() => setIsPochtaPickerOpen(true)}
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
                        placeholder="Поиск по индексу или адресу отделения..."
                        value={pochtaSearchQuery}
                        onChange={(e) => setPochtaSearchQuery(e.target.value)}
                      />
                    </div>
                    <div className={styles.pvzList}>
                      {isLoadingPochta ? (
                        <div className={styles.pvzEmpty}>Загружаем отделения связи Почты России…</div>
                      ) : filteredPochtaOffices.length === 0 ? (
                        <div className={styles.pvzEmpty}>Отделения не найдены по указанному индексу.</div>
                      ) : (
                        filteredPochtaOffices.map((office) => {
                          const isSelected = selectedPochtaOffice?.postalCode === office.postalCode;
                          return (
                            <div
                              key={office.postalCode}
                              className={`${styles.pvzItem} ${isSelected ? styles.pvzItemActive : ""}`}
                              onClick={() => {
                                if (office.isClosed) return;
                                setSelectedPochtaOffice(office);
                                if (office.settlement) setForm((prev) => ({ ...prev, city: office.settlement ?? "" }));
                                setIsPochtaPickerOpen(false);
                                setErrors((prev) => ({ ...prev, pochtaOffice: "", ...(office.settlement ? { city: "" } : {}) }));
                              }}
                            >
                              <div className={styles.pvzItemTop}>
                                <span className={styles.pvzAddress}>ОПС {office.postalCode} · {office.addressSource}</span>
                                <span className={styles.pvzBadge}>Почта РФ</span>
                              </div>
                              <div className={styles.pvzMeta}>
                                <span className={styles.pvzHours}>{office.workHours}</span>
                                {office.settlement && <span>· {office.settlement}</span>}
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                )}
                {errors.pochtaOffice && <span className={styles.fieldError}>{errors.pochtaOffice}</span>}
              </div>
            )}

            {/* ── Mode: Russian Post Courier EMS ── */}
            {deliveryType === "pochta-courier" && (
              <div>
                <p className={styles.deliverySub} style={{ marginBottom: 12 }}>
                  Доставка «Курьер онлайн» / EMS Почты России до двери по всей стране:
                </p>
                <div className={styles.formRow}>
                  <div className={styles.formGroup}>
                    <label className={styles.formLabel}>Город *</label>
                    <input
                      name="city"
                      required
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
                  <label className={styles.formLabel}>Улица, дом, корпус *</label>
                  <input
                    name="address"
                    required
                    className={`${styles.formInput}${errors.address ? ` ${styles.formInputError}` : ""}`}
                    placeholder="ул. Ленина, д. 10"
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
                    placeholder="кв. 15"
                    value={form.apartment}
                    onChange={handleChange}
                  />
                </div>
              </div>
            )}

            {/* ── Mode: Retail Store Pickup ── */}
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
                осознанно, а сам факт согласия: доказуемо. */}
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

            <button type="submit" className={styles.submitBtn} disabled={isSubmitting || isDeliveryUnavailable}>
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
