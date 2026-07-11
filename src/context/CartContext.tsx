"use client";

import React, { createContext, useContext, useEffect, useState } from "react";
import { MOCK_PRODUCTS, Product } from "../data/mockData";

export interface CartItem {
  product: Product;
  selectedSize: string;
  selectedColor: { name: string; hex: string };
  quantity: number;
}

interface StoredCartItem {
  productId: string;
  selectedSize: string;
  selectedColor: { name: string; hex: string };
  quantity: number;
}

interface CartContextType {
  // Cart States
  cartItems: CartItem[];
  isCartOpen: boolean;
  addToCart: (item: CartItem) => void;
  removeFromCart: (productId: string, size: string, colorHex: string) => void;
  updateQuantity: (productId: string, size: string, colorHex: string, quantity: number) => void;
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
const CART_STORAGE_KEY = "clothing-store-cart";
const FAVORITES_STORAGE_KEY = "clothing-store-favorites";

function isCartItem(value: unknown): value is CartItem {
  if (!value || typeof value !== "object") return false;

  const item = value as CartItem;
  return (
    Boolean(item.product?.id) &&
    typeof item.selectedSize === "string" &&
    typeof item.selectedColor?.hex === "string" &&
    typeof item.quantity === "number" &&
    item.quantity > 0
  );
}

function isStoredCartItem(value: unknown): value is StoredCartItem {
  if (!value || typeof value !== "object") return false;

  const item = value as StoredCartItem;
  return (
    typeof item.productId === "string" &&
    typeof item.selectedSize === "string" &&
    typeof item.selectedColor?.hex === "string" &&
    typeof item.quantity === "number" &&
    item.quantity > 0
  );
}

function restoreCartItem(value: unknown): CartItem | null {
  if (isCartItem(value)) return value;
  if (!isStoredCartItem(value)) return null;

  const product = MOCK_PRODUCTS.find((item) => item.id === value.productId);
  if (!product) return null;

  return {
    product,
    selectedSize: value.selectedSize,
    selectedColor: value.selectedColor,
    quantity: value.quantity,
  };
}

function serializeCartItem(item: CartItem): StoredCartItem {
  return {
    productId: item.product.id,
    selectedSize: item.selectedSize,
    selectedColor: item.selectedColor,
    quantity: item.quantity,
  };
}

export function CartProvider({ children }: { children: React.ReactNode }) {
  // Cart items
  const [cartItems, setCartItems] = useState<CartItem[]>([]);
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [isCartHydrated, setIsCartHydrated] = useState(false);
  const [favoriteProductIds, setFavoriteProductIds] = useState<string[]>([]);
  const [isFavoritesHydrated, setIsFavoritesHydrated] = useState(false);
  const cartCount = cartItems.reduce((acc, item) => acc + item.quantity, 0);
  const cartTotal = cartItems.reduce(
    (acc, item) => acc + item.product.price * item.quantity,
    0
  );
  const favoriteCount = favoriteProductIds.length;

  // Shop Navigation
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  useEffect(() => {
    let isMounted = true;

    try {
      const savedCart = window.localStorage.getItem(CART_STORAGE_KEY);
      const parsedCart: unknown = savedCart ? JSON.parse(savedCart) : [];
      const nextCart = Array.isArray(parsedCart)
        ? parsedCart
            .map(restoreCartItem)
            .filter((item): item is CartItem => item !== null)
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
    if (!isCartHydrated) return;

    window.localStorage.setItem(
      CART_STORAGE_KEY,
      JSON.stringify(cartItems.map(serializeCartItem))
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

  const addToCart = (newItem: CartItem) => {
    setCartItems((prevItems) => {
      // Check if product with exact same size and color is already in cart
      const existingItemIndex = prevItems.findIndex(
        (item) =>
          item.product.id === newItem.product.id &&
          item.selectedSize === newItem.selectedSize &&
          item.selectedColor.hex === newItem.selectedColor.hex
      );

      if (existingItemIndex > -1) {
        // Increment quantity of existing item
        const updatedItems = [...prevItems];
        updatedItems[existingItemIndex] = {
          ...updatedItems[existingItemIndex],
          quantity: updatedItems[existingItemIndex].quantity + newItem.quantity,
        };
        return updatedItems;
      }

      // Add new item to cart
      return [...prevItems, newItem];
    });
    
  };

  const removeFromCart = (productId: string, size: string, colorHex: string) => {
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

  const updateQuantity = (
    productId: string,
    size: string,
    colorHex: string,
    newQuantity: number
  ) => {
    if (newQuantity < 1) return;
    
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
