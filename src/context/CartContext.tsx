"use client";

import React, { createContext, useContext, useEffect, useEffectEvent, useRef, useState } from "react";
import { Product } from "../data/mockData";
import { useCatalog } from "./CatalogContext";
import {
  addMedusaCartLineItem,
  addMedusaCartShippingMethod,
  completeMedusaCart,
  createMedusaPaymentCollection,
  createMedusaCart,
  isMedusaConfigured,
  initializeMedusaPaymentSession,
  listMedusaShippingOptions,
  mapCartLineToProduct,
  type MedusaShippingOption,
  type MedusaCartLine,
  removeMedusaCartLineItem,
  retrieveMedusaCart,
  storefrontDataMode,
  updateMedusaCartLineItem,
  updateMedusaCart,
} from "../lib/medusa";

export interface CartItem {
  product: Product;
  selectedSize: string;
  selectedColor: { name: string; hex: string };
  variantId: string;
  lineItemId?: string;
  unitPrice?: number | null;
  lineTotal?: number | null;
  quantity: number;
}

export interface CheckoutDetails {
  email: string;
  firstName: string;
  lastName: string;
  phone: string;
  city: string;
  address: string;
  apartment: string;
  zip: string;
  /**
   * Идентификатор выбранной опции доставки Medusa.
   *
   * Раньше выбор способа доставки жил только в состоянии формы и не доходил до
   * бэкенда: любой заказ уезжал с единственной захардкоженной опцией
   * «MVP доставка по России», независимо от того, что выбрал покупатель.
   */
  shippingOptionId: string;
  comment: string;
}

type CheckoutCompletion =
  | { type: "redirect"; paymentUrl: string }
  | { type: "order"; id: string; displayId?: number | null };

interface CartContextType {
  // Cart States
  cartItems: CartItem[];
  isCartOpen: boolean;
  addToCart: (item: CartItem) => Promise<void>;
  removeFromCart: (productId: string, size: string, colorHex: string) => Promise<void>;
  updateQuantity: (productId: string, size: string, colorHex: string, quantity: number) => Promise<void>;
  prepareCheckout: (details: CheckoutDetails) => Promise<void>;
  getShippingOptions: () => Promise<MedusaShippingOption[]>;
  completeCheckout: () => Promise<CheckoutCompletion>;
  toggleCart: () => void;
  setIsCartOpen: (isOpen: boolean) => void;
  cartCount: number;
  /** `null` — сумма неизвестна: сервер не ответил. Показывать её нельзя. */
  cartTotal: number | null;
  cartSubtotal: number | null;
  cartShippingTotal: number | null;
  cartTaxTotal: number | null;
  cartDiscountTotal: number | null;
  isCartMutating: boolean;
  /** Последняя неудавшаяся операция с корзиной, текстом для покупателя. */
  cartError: string | null;
  dismissCartError: () => void;
  favoriteProductIds: string[];
  favoriteCount: number;
  toggleFavorite: (productId: string) => void;
  removeFavorite: (productId: string) => void;
  isFavorite: (productId: string) => boolean;

  // Shop / Navigation States (Phase 4)
  isMenuOpen: boolean;
  toggleMenu: () => void;
  setIsMenuOpen: (isOpen: boolean) => void;
}

const CartContext = createContext<CartContextType | undefined>(undefined);
const CART_STORAGE_KEY = `clothing-store-cart-${storefrontDataMode}`;
const MEDUSA_CART_STORAGE_KEY = "clothing-store-medusa-cart";
const FAVORITES_STORAGE_KEY = "clothing-store-favorites";

function isCartItem(value: unknown): value is CartItem {
  if (!value || typeof value !== "object") return false;

  const item = value as CartItem;
  return (
    Boolean(item.product?.id) &&
    typeof item.selectedSize === "string" &&
    typeof item.selectedColor?.hex === "string" &&
    typeof item.variantId === "string" &&
    typeof item.quantity === "number" &&
    item.quantity > 0
  );
}

export function CartProvider({ children }: { children: React.ReactNode }) {
  const { products } = useCatalog();
  // Cart items
  const [cartItems, setCartItems] = useState<CartItem[]>([]);
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [isCartHydrated, setIsCartHydrated] = useState(false);
  const [favoriteProductIds, setFavoriteProductIds] = useState<string[]>([]);
  const [isFavoritesHydrated, setIsFavoritesHydrated] = useState(false);
  const [serverCartTotal, setServerCartTotal] = useState<number | null>(null);
  const [serverCartTotals, setServerCartTotals] = useState({ subtotal: 0, shipping: 0, tax: 0, discount: 0 });
  const [mutationCount, setMutationCount] = useState(0);
  const [cartError, setCartError] = useState<string | null>(null);
  const cartItemsRef = useRef<CartItem[]>([]);
  const mutationQueue = useRef(Promise.resolve());
  const cartCount = cartItems.reduce((acc, item) => acc + item.quantity, 0);
  const isCartMutating = mutationCount > 0;
  const favoriteCount = favoriteProductIds.length;

  // Кто считает деньги.
  //
  // В mock-режиме считать больше некому, поэтому сумма собирается на клиенте.
  // В medusa-режиме единственный источник — ответ сервера (ADR-001 §5: цена,
  // скидка, налог и итог подтверждаются backend). Раньше при недоступной
  // корзине код тихо переключался на локальную сумму, посчитанную по ценам из
  // localStorage — а они могли быть записаны когда угодно раньше и не
  // проверялись ни на возраст, ни на версию схемы. Покупателю показывалась
  // уверенная цифра, не имеющая отношения к тому, что спишет банк. Теперь
  // неизвестная сумма так и остаётся неизвестной: `null` — это «не знаем», и
  // интерфейс обязан показать именно это.
  const isServerPricedCart = storefrontDataMode === "medusa";
  const localCartTotal = cartItems.reduce(
    (acc, item) => acc + item.product.price * item.quantity,
    0,
  );
  const hasServerTotals = serverCartTotal !== null;
  const cartTotal = isServerPricedCart ? serverCartTotal : localCartTotal;
  const cartSubtotal = isServerPricedCart
    ? (hasServerTotals ? serverCartTotals.subtotal : null)
    : localCartTotal;
  const cartShippingTotal = isServerPricedCart
    ? (hasServerTotals ? serverCartTotals.shipping : null)
    : 0;
  const cartTaxTotal = isServerPricedCart
    ? (hasServerTotals ? serverCartTotals.tax : null)
    : 0;
  const cartDiscountTotal = isServerPricedCart
    ? (hasServerTotals ? serverCartTotals.discount : null)
    : 0;

  // Shop Navigation
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  /**
   * Опознать позицию серверной корзины, перебирая источники от самого полного
   * к самому скудному.
   *
   * Порядок важен. Каталог даёт настоящую карточку с палитрой и размерной
   * сеткой, поэтому идёт первым — и позиция, собранная раньше из строки
   * Medusa, повышается до полноценной, как только каталог догрузился. Строка
   * корзины идёт последней и НИКОГДА не приводит к отбрасыванию позиции: до
   * этой правки товар за пределами первой страницы каталога просто исчезал из
   * корзины, хотя серверный `total` продолжал его учитывать.
   */
  const resolveCartLine = (remoteItem: MedusaCartLine, currentItems: CartItem[]): CartItem => {
    const product = products.find((candidate) =>
      candidate.variants.some((variant) => variant.variantId === remoteItem.variant_id),
    );
    const variant = product?.variants.find((candidate) => candidate.variantId === remoteItem.variant_id);

    if (product && variant) {
      const colorName = variant.options.Цвет ?? "";
      return {
        product,
        selectedSize: variant.options.Размер ?? "",
        selectedColor:
          product.colors.find((color) => color.name === colorName) ?? { name: colorName, hex: "#808080" },
        variantId: variant.variantId,
        quantity: remoteItem.quantity,
      };
    }

    const existingItem = currentItems.find((item) => item.variantId === remoteItem.variant_id);
    if (existingItem) return existingItem;

    const lineProduct = mapCartLineToProduct(remoteItem);
    return {
      product: lineProduct,
      selectedSize: lineProduct.availableSizes[0] ?? "",
      selectedColor: { name: "", hex: "#808080" },
      variantId: remoteItem.variant_id ?? remoteItem.id,
      quantity: remoteItem.quantity,
    };
  };

  const syncRemoteCart = (cart: Awaited<ReturnType<typeof retrieveMedusaCart>>) => {
    setServerCartTotal(typeof cart.total === "number" ? cart.total : null);
    setServerCartTotals({
      subtotal: cart.subtotal ?? 0,
      shipping: cart.shipping_total ?? 0,
      tax: cart.tax_total ?? 0,
      discount: cart.discount_total ?? 0,
    });
    const items = cart.items || [];
    setCartItems((currentItems) => {
      const nextItems = items.map((remoteItem) => ({
        ...resolveCartLine(remoteItem, currentItems),
        lineItemId: remoteItem.id,
        quantity: remoteItem.quantity,
        unitPrice: remoteItem.unit_price,
        lineTotal: remoteItem.total,
      }));
      cartItemsRef.current = nextItems;
      return nextItems;
    });
  };

  const restoreRemoteCart = useEffectEvent((cart: Awaited<ReturnType<typeof retrieveMedusaCart>>) => {
    syncRemoteCart(cart);
  });

  useEffect(() => {
    cartItemsRef.current = cartItems;
  }, [cartItems]);

  useEffect(() => {
    let isMounted = true;

    try {
      const savedCart = window.localStorage.getItem(CART_STORAGE_KEY);
      const parsedCart: unknown = savedCart ? JSON.parse(savedCart) : [];
      const nextCart = Array.isArray(parsedCart)
        ? parsedCart.filter(isCartItem)
        : [];

      window.setTimeout(() => {
        if (!isMounted) return;
        setCartItems(nextCart);
        setIsCartHydrated(true);
      }, 0);
    } catch {
      window.localStorage.removeItem(CART_STORAGE_KEY);
      window.setTimeout(() => {
        if (!isMounted) return;
        setIsCartHydrated(true);
      }, 0);
    }

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (!isCartHydrated || !isMedusaConfigured) return;

    const cartId = window.localStorage.getItem(MEDUSA_CART_STORAGE_KEY);
    if (!cartId) return;

    retrieveMedusaCart(cartId)
      .then(restoreRemoteCart)
      .catch((error: unknown) => console.warn("Unable to restore Medusa cart.", error));
  }, [isCartHydrated, products]);

  useEffect(() => {
    if (!isCartHydrated) return;

    window.localStorage.setItem(
      CART_STORAGE_KEY,
        JSON.stringify(cartItems)
    );
  }, [cartItems, isCartHydrated]);

  useEffect(() => {
    let isMounted = true;

    try {
      const savedFavorites = window.localStorage.getItem(FAVORITES_STORAGE_KEY);
      const parsedFavorites: unknown = savedFavorites ? JSON.parse(savedFavorites) : [];
      const nextFavorites = Array.isArray(parsedFavorites)
        ? parsedFavorites.filter((id): id is string => typeof id === "string")
        : [];

      window.setTimeout(() => {
        if (!isMounted) return;
        setFavoriteProductIds([...new Set(nextFavorites)]);
        setIsFavoritesHydrated(true);
      }, 0);
    } catch {
      window.localStorage.removeItem(FAVORITES_STORAGE_KEY);
      window.setTimeout(() => {
        if (!isMounted) return;
        setIsFavoritesHydrated(true);
      }, 0);
    }

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (!isFavoritesHydrated) return;

    window.localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(favoriteProductIds));
  }, [favoriteProductIds, isFavoritesHydrated]);

  const getMedusaCartId = async () => {
    const existingCartId = window.localStorage.getItem(MEDUSA_CART_STORAGE_KEY);
    if (existingCartId) return existingCartId;

    const cart = await createMedusaCart();
    window.localStorage.setItem(MEDUSA_CART_STORAGE_KEY, cart.id);
    return cart.id;
  };

  const enqueueCartMutation = <T,>(operation: () => Promise<T>) => {
    const tracked = () => {
      setMutationCount((c) => c + 1);
      return operation().finally(() => {
        setMutationCount((c) => c - 1);
      });
    };
    const next = mutationQueue.current.then(tracked, tracked);
    mutationQueue.current = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  };

  /**
   * Обёртка для операций, которые вызываются как «нажал и забыл».
   *
   * Все двенадцать мест вызова `addToCart`/`updateQuantity`/`removeFromCart`
   * игнорировали возвращаемый промис, поэтому 401 из-за ключа, 400 из-за
   * остатка или обрыв сети выглядели как «кнопка не работает» и не оставляли
   * следа: ни сообщения покупателю, ни записи в консоли. Здесь отказ
   * превращается в состояние, которое интерфейс обязан показать.
   */
  const dismissCartError = () => setCartError(null);

  const runCartMutation = (operation: () => Promise<void>, failureMessage: string) => {
    setCartError(null);
    return enqueueCartMutation(operation).catch((error: unknown) => {
      console.error(`[Cart] ${failureMessage}`, error);
      setCartError(failureMessage);
    });
  };

  const addToCart = (newItem: CartItem) => runCartMutation(async () => {
    if (storefrontDataMode === "medusa" && !isMedusaConfigured) {
      throw new Error("Medusa mode requires a backend URL and publishable API key.");
    }

    if (storefrontDataMode === "medusa") {
      const cartId = await getMedusaCartId();
      let cart = await addMedusaCartLineItem(cartId, newItem.variantId, newItem.quantity);
      // If the server merged or relocated the line item, fall back to a fresh retrieval
      if (!cart.items?.some((item) => item.variant_id === newItem.variantId)) {
        cart = await retrieveMedusaCart(cartId);
      }
      // Full reconciliation: resolves lineItemId for every local item from server state
      syncRemoteCart(cart);
      return;
    }

    setCartItems((prevItems) => {
      // Check if product with exact same size and color is already in cart
      const existingItemIndex = prevItems.findIndex(
        (item) =>
          item.product.id === newItem.product.id &&
          item.selectedSize === newItem.selectedSize &&
          item.selectedColor.hex === newItem.selectedColor.hex
      );

      if (existingItemIndex > -1) {
        const updatedItems = [...prevItems];
        updatedItems[existingItemIndex] = {
          ...updatedItems[existingItemIndex],
          quantity: updatedItems[existingItemIndex].quantity + newItem.quantity,
        };
        cartItemsRef.current = updatedItems;
        return updatedItems;
      }

      const updatedItems = [...prevItems, newItem];
      cartItemsRef.current = updatedItems;
      return updatedItems;
    });
  }, "Не удалось добавить товар в корзину. Попробуйте ещё раз.");

  const removeFromCart = (productId: string, size: string, colorHex: string) => runCartMutation(async () => {
    const item = cartItemsRef.current.find(
      (cartItem) => cartItem.product.id === productId && cartItem.selectedSize === size && cartItem.selectedColor.hex === colorHex,
    );

    if (storefrontDataMode === "medusa") {
      const cartId = await getMedusaCartId();
      let resolvedLineItemId = item?.lineItemId;

      // Resolve lineItemId if missing by fetching fresh server state
      if (!resolvedLineItemId) {
        const freshCart = await retrieveMedusaCart(cartId);
        const serverItem = freshCart.items?.find((si) => si.variant_id === item?.variantId);
        if (!serverItem) {
          // Item genuinely doesn't exist on the server — reconcile and warn
          console.warn("[Cart] removeFromCart: item not found on server, reconciling.", { variantId: item?.variantId, operation: "removeFromCart" });
          syncRemoteCart(freshCart);
          return;
        }
        resolvedLineItemId = serverItem.id;
      }

      const cart = await removeMedusaCartLineItem(cartId, resolvedLineItemId);
      syncRemoteCart(cart);
      return;
    }

    setCartItems((prevItems) => {
      const updatedItems = prevItems.filter(
        (cartItem) =>
          !(
            cartItem.product.id === productId &&
            cartItem.selectedSize === size &&
            cartItem.selectedColor.hex === colorHex
          )
      );
      cartItemsRef.current = updatedItems;
      return updatedItems;
    });
  }, "Не удалось удалить товар из корзины. Попробуйте ещё раз.");

  const updateQuantity = (
    productId: string,
    size: string,
    colorHex: string,
    newQuantity: number
  ) => runCartMutation(async () => {
    if (newQuantity < 1) return;
    const item = cartItemsRef.current.find(
      (cartItem) => cartItem.product.id === productId && cartItem.selectedSize === size && cartItem.selectedColor.hex === colorHex,
    );

    if (storefrontDataMode === "medusa") {
      const cartId = await getMedusaCartId();
      let resolvedLineItemId = item?.lineItemId;

      // Resolve lineItemId if missing by fetching fresh server state
      if (!resolvedLineItemId) {
        const freshCart = await retrieveMedusaCart(cartId);
        const serverItem = freshCart.items?.find((si) => si.variant_id === item?.variantId);
        if (!serverItem) {
          // Item genuinely doesn't exist on the server — reconcile and warn
          console.warn("[Cart] updateQuantity: item not found on server, reconciling.", { variantId: item?.variantId, operation: "updateQuantity" });
          syncRemoteCart(freshCart);
          return;
        }
        resolvedLineItemId = serverItem.id;
      }

      const cart = await updateMedusaCartLineItem(cartId, resolvedLineItemId, newQuantity);
      syncRemoteCart(cart);
      return;
    }

    setCartItems((prevItems) => {
      const updatedItems = prevItems.map((cartItem) =>
        cartItem.product.id === productId &&
        cartItem.selectedSize === size &&
        cartItem.selectedColor.hex === colorHex
          ? { ...cartItem, quantity: newQuantity }
          : cartItem
      );
      cartItemsRef.current = updatedItems;
      return updatedItems;
    });
  }, "Не удалось изменить количество. Попробуйте ещё раз.");

  const prepareCheckout = (details: CheckoutDetails) => enqueueCartMutation(async () => {
    if (!isMedusaConfigured) {
      throw new Error("Checkout requires Medusa mode with a configured Store API.");
    }

    if (!details.shippingOptionId) {
      throw new Error("Не выбран способ доставки.");
    }

    const cartId = await getMedusaCartId();
    await updateMedusaCart(cartId, {
      email: details.email,
      shipping_address: {
        first_name: details.firstName,
        last_name: details.lastName,
        phone: details.phone,
        address_1: details.address,
        address_2: details.apartment || undefined,
        city: details.city,
        country_code: "ru",
        postal_code: details.zip,
      },
      // Комментарий раньше терялся: он лежал в объекте деталей, но в тело
      // запроса не попадал, а excess property check его не ловил, потому что
      // передавалась переменная. Логист узнавал о пожеланиях покупателя ниоткуда.
      ...(details.comment.trim() ? { metadata: { customer_note: details.comment.trim() } } : {}),
    });

    // Способ доставки выбирает покупатель. Витрина больше не подставляет
    // единственную известную ей опцию: список приходит из Medusa, и в заказ
    // уходит ровно то, что выбрано в форме.
    const shippingOptions = await listMedusaShippingOptions(cartId);
    const shippingOption = shippingOptions.find((option) => option.id === details.shippingOptionId);
    if (!shippingOption) {
      throw new Error(
        "Выбранный способ доставки больше не доступен для этого адреса. Выберите другой.",
      );
    }

    syncRemoteCart(await addMedusaCartShippingMethod(cartId, shippingOption.id));
  });

  /**
   * Способы доставки, доступные для текущей корзины.
   *
   * Живёт в контексте, потому что идентификатор корзины Medusa создаётся и
   * хранится здесь же — форме чекаута незачем знать про localStorage.
   */
  const getShippingOptions = async () => {
    if (!isMedusaConfigured) {
      throw new Error("Checkout requires Medusa mode with a configured Store API.");
    }
    return listMedusaShippingOptions(await getMedusaCartId());
  };

  const completeCheckout = () => enqueueCartMutation<CheckoutCompletion>(async () => {
    if (!isMedusaConfigured) {
      throw new Error("Checkout requires Medusa mode with a configured Store API.");
    }

    const cartId = await getMedusaCartId();
    const paymentCollection = await createMedusaPaymentCollection(cartId);
    const paymentSession = await initializeMedusaPaymentSession(paymentCollection.id);

    // Встроенный провайдер оставлен только для локального/e2e escape hatch.
    // Боевой redirect-провайдер не должен создавать заказ до оплаты: успешный
    // подписанный webhook завершит эту же корзину через workflow Medusa.
    if (paymentSession.provider_id !== "pp_system_default") {
      if (paymentSession.status !== "pending_authorization") {
        throw new Error(
          `Платёжный провайдер вернул неожиданное состояние: ${paymentSession.status}.`,
        );
      }
      const paymentUrl = paymentSession.data.paymentUrl;
      if (typeof paymentUrl !== "string") {
        throw new Error("Платёжный провайдер не вернул ссылку на оплату.");
      }

      let parsedPaymentUrl: URL;
      try {
        parsedPaymentUrl = new URL(paymentUrl);
      } catch {
        throw new Error("Платёжный провайдер вернул некорректную ссылку на оплату.");
      }
      if (parsedPaymentUrl.protocol !== "https:") {
        throw new Error("Платёжный провайдер вернул небезопасную ссылку на оплату.");
      }

      return { type: "redirect", paymentUrl: parsedPaymentUrl.toString() };
    }

    const response = await completeMedusaCart(cartId);
    if (response.type !== "order") {
      throw new Error(response.error.message);
    }

    window.localStorage.removeItem(MEDUSA_CART_STORAGE_KEY);
    cartItemsRef.current = [];
    setCartItems([]);
    setServerCartTotal(null);
    return { type: "order", id: response.order.id, displayId: response.order.display_id };
  });

  const toggleFavorite = (productId: string) => {
    setFavoriteProductIds((previous) =>
      previous.includes(productId)
        ? previous.filter((id) => id !== productId)
        : [...previous, productId]
    );
  };

  const removeFavorite = (productId: string) => {
    setFavoriteProductIds((previous) => previous.filter((id) => id !== productId));
  };

  const isFavorite = (productId: string) => favoriteProductIds.includes(productId);

  const toggleCart = () => {
    setIsCartOpen((prev) => !prev);
    if (isMenuOpen) setIsMenuOpen(false); // Close left menu if cart is opened
  };

  const toggleMenu = () => {
    setIsMenuOpen((prev) => !prev);
    if (isCartOpen) setIsCartOpen(false); // Close cart if left menu is opened
  };

  return (
    <CartContext.Provider
      value={{
        cartItems,
        isCartOpen,
        addToCart,
        removeFromCart,
        updateQuantity,
        prepareCheckout,
        getShippingOptions,
        completeCheckout,
        toggleCart,
        setIsCartOpen,
        cartCount,
        cartTotal,
        cartSubtotal,
        cartShippingTotal,
        cartTaxTotal,
        cartDiscountTotal,
        isCartMutating,
        cartError,
        dismissCartError,
        favoriteProductIds,
        favoriteCount,
        toggleFavorite,
        removeFavorite,
        isFavorite,
        isMenuOpen,
        toggleMenu,
        setIsMenuOpen,
      }}
    >
      {children}
    </CartContext.Provider>
  );
}

export function useCart() {
  const context = useContext(CartContext);
  if (context === undefined) {
    throw new Error("useCart must be used within a CartProvider");
  }
  return context;
}
