"use client";

import React, { createContext, useContext, useEffect, useState } from "react";
import { Product } from "../data/mockData";
import {
  addMedusaCartLineItem,
  createMedusaCart,
  isMedusaConfigured,
  removeMedusaCartLineItem,
  retrieveMedusaCart,
  storefrontDataMode,
  updateMedusaCartLineItem,
} from "../lib/medusa";

export interface CartItem {
  product: Product;
  selectedSize: string;
  selectedColor: { name: string; hex: string };
  variantId: string;
  lineItemId?: string;
  quantity: number;
}

interface CartContextType {
  // Cart States
  cartItems: CartItem[];
  isCartOpen: boolean;
  addToCart: (item: CartItem) => Promise<void>;
  removeFromCart: (productId: string, size: string, colorHex: string) => Promise<void>;
  updateQuantity: (productId: string, size: string, colorHex: string, quantity: number) => Promise<void>;
  toggleCart: () => void;
  setIsCartOpen: (isOpen: boolean) => void;
  cartCount: number;
  cartTotal: number;
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
  // Cart items
  const [cartItems, setCartItems] = useState<CartItem[]>([]);
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [isCartHydrated, setIsCartHydrated] = useState(false);
  const [favoriteProductIds, setFavoriteProductIds] = useState<string[]>([]);
  const [isFavoritesHydrated, setIsFavoritesHydrated] = useState(false);
  const [serverCartTotal, setServerCartTotal] = useState<number | null>(null);
  const cartCount = cartItems.reduce((acc, item) => acc + item.quantity, 0);
  const cartTotal = isMedusaConfigured && serverCartTotal !== null
    ? serverCartTotal
    : cartItems.reduce((acc, item) => acc + item.product.price * item.quantity, 0);
  const favoriteCount = favoriteProductIds.length;

  // Shop Navigation
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  const syncRemoteCart = (cart: Awaited<ReturnType<typeof retrieveMedusaCart>>) => {
    setServerCartTotal(typeof cart.total === "number" ? cart.total : null);
    const items = cart.items || [];
    setCartItems((currentItems) =>
      currentItems
        .flatMap((item) => {
          const remoteItem = items.find((remote) => remote.variant_id === item.variantId);
          return remoteItem ? [{ ...item, lineItemId: remoteItem.id, quantity: remoteItem.quantity }] : [];
        }),
    );
  };

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
      .then(syncRemoteCart)
      .catch(() => window.localStorage.removeItem(MEDUSA_CART_STORAGE_KEY));
  }, [isCartHydrated]);

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

  const addToCart = async (newItem: CartItem) => {
    if (storefrontDataMode === "medusa" && !isMedusaConfigured) {
      throw new Error("Medusa mode requires a backend URL and publishable API key.");
    }

    if (storefrontDataMode === "medusa") {
      const cartId = await getMedusaCartId();
      const cart = await addMedusaCartLineItem(cartId, newItem.variantId, newItem.quantity);
      setServerCartTotal(typeof cart.total === "number" ? cart.total : null);
      const lineItem = cart.items?.find((item) => item.variant_id === newItem.variantId);
      newItem = { ...newItem, lineItemId: lineItem?.id, quantity: lineItem?.quantity ?? newItem.quantity };
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
          lineItemId: newItem.lineItemId ?? updatedItems[existingItemIndex].lineItemId,
          quantity: storefrontDataMode === "medusa"
            ? newItem.quantity
            : updatedItems[existingItemIndex].quantity + newItem.quantity,
        };
        return updatedItems;
      }

      return [...prevItems, newItem];
    });
    
  };

  const removeFromCart = async (productId: string, size: string, colorHex: string) => {
    const item = cartItems.find(
      (cartItem) => cartItem.product.id === productId && cartItem.selectedSize === size && cartItem.selectedColor.hex === colorHex,
    );
    if (storefrontDataMode === "medusa" && item?.lineItemId) {
      const cartId = await getMedusaCartId();
      const cart = await removeMedusaCartLineItem(cartId, item.lineItemId);
      setServerCartTotal(typeof cart.total === "number" ? cart.total : null);
    }
    setCartItems((prevItems) =>
      prevItems.filter(
        (item) =>
          !(
            item.product.id === productId &&
            item.selectedSize === size &&
            item.selectedColor.hex === colorHex
          )
      )
    );
  };

  const updateQuantity = async (
    productId: string,
    size: string,
    colorHex: string,
    newQuantity: number
  ) => {
    if (newQuantity < 1) return;
    const item = cartItems.find(
      (cartItem) => cartItem.product.id === productId && cartItem.selectedSize === size && cartItem.selectedColor.hex === colorHex,
    );
    if (storefrontDataMode === "medusa" && item?.lineItemId) {
      const cartId = await getMedusaCartId();
      const cart = await updateMedusaCartLineItem(cartId, item.lineItemId, newQuantity);
      setServerCartTotal(typeof cart.total === "number" ? cart.total : null);
    }
    
    setCartItems((prevItems) =>
      prevItems.map((item) =>
        item.product.id === productId &&
        item.selectedSize === size &&
        item.selectedColor.hex === colorHex
          ? { ...item, quantity: newQuantity }
          : item
      )
    );
  };

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
        toggleCart,
        setIsCartOpen,
        cartCount,
        cartTotal,
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
