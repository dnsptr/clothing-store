"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { MOCK_PRODUCTS, type Product } from "../data/mockData";
import { fetchMedusaProducts, isMedusaConfigured } from "../lib/medusa";

interface CatalogContextValue {
  products: Product[];
  source: "medusa" | "mock";
}

const CatalogContext = createContext<CatalogContextValue | undefined>(undefined);

export function CatalogProvider({ children }: { children: React.ReactNode }) {
  const [products, setProducts] = useState(MOCK_PRODUCTS);
  const [source, setSource] = useState<CatalogContextValue["source"]>("mock");

  useEffect(() => {
    if (!isMedusaConfigured) return;

    const controller = new AbortController();

    fetchMedusaProducts(controller.signal)
      .then((nextProducts) => {
        if (!nextProducts.length) return;
        setProducts(nextProducts);
        setSource("medusa");
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        console.warn("Medusa catalog is unavailable; using demo data.", error);
      });

    return () => controller.abort();
  }, []);

  return (
    <CatalogContext.Provider value={{ products, source }}>
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
