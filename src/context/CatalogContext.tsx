"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { MOCK_PRODUCTS, type Product } from "../data/mockData";
import { fetchMedusaProducts, isMedusaConfigured, storefrontDataMode } from "../lib/medusa";

interface CatalogContextValue {
  products: Product[];
  source: "medusa" | "mock";
  status: "error" | "loading" | "ready";
  refetch: () => void;
}

const CatalogContext = createContext<CatalogContextValue | undefined>(undefined);

export function CatalogProvider({ children }: { children: React.ReactNode }) {
  const [products, setProducts] = useState<Product[]>(
    storefrontDataMode === "mock" ? MOCK_PRODUCTS : [],
  );
  const [status, setStatus] = useState<CatalogContextValue["status"]>(
    storefrontDataMode === "mock" ? "ready" : isMedusaConfigured ? "loading" : "error",
  );
  const source = storefrontDataMode;
  const abortRef = useRef<AbortController | null>(null);

  // Single loader shared by the initial mount effect and the manual refetch.
  // A ref-held AbortController cancels any in-flight request before starting a
  // new one and lets unmount abort cleanly, avoiding stale state updates.
  // Note: loadProducts deliberately does NOT set the "loading" status itself —
  // on mount it is already the initial state, and setting state synchronously
  // inside an effect violates react-hooks/set-state-in-effect. The manual
  // refetch (an event handler, where sync setState is fine) sets it instead.
  //
  // FE-004: the global context intentionally loads only the FIRST page (24). It
  // powers the home page, recommendations and favorites — all of which resolve
  // products from this list. With the current catalog (12 products) the first
  // page covers everything. KNOWN LIMITATION: once the catalog exceeds 24
  // products, favorites/recommendations that reference later products won't
  // resolve here; scaling those to fetch by id is a separate task. The catalog
  // page (FE-004 A3) does its own paginated fetch and does not depend on this.
  const loadProducts = useCallback(() => {
    if (storefrontDataMode === "mock" || !isMedusaConfigured) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    fetchMedusaProducts({ limit: 24, offset: 0 }, controller.signal)
      .then(({ products: nextProducts }) => {
        if (controller.signal.aborted) return;
        setProducts(nextProducts);
        setStatus("ready");
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        console.error("Medusa catalog is unavailable.", error);
        setStatus("error");
      });
  }, []);

  const refetch = useCallback(() => {
    setStatus("loading");
    loadProducts();
  }, [loadProducts]);

  useEffect(() => {
    loadProducts();
    return () => abortRef.current?.abort();
  }, [loadProducts]);

  return (
    <CatalogContext.Provider value={{ products, source, status, refetch }}>
      {children}
    </CatalogContext.Provider>
  );
}

export function useCatalog() {
  const context = useContext(CatalogContext);

  if (!context) {
    throw new Error("useCatalog must be used within a CatalogProvider");
  }

  return context;
}
