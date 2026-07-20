"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { MOCK_PRODUCTS, type Product } from "../data/mockData";
import { fetchMedusaProducts, isMedusaConfigured, storefrontDataMode } from "../lib/medusa";

interface CatalogContextValue {
  products: Product[];
  source: "medusa" | "mock";
  status: "error" | "loading" | "ready";
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

  useEffect(() => {
    if (storefrontDataMode === "mock") return;

    if (!isMedusaConfigured) {
      return;
    }

    const controller = new AbortController();

    fetchMedusaProducts(controller.signal)
      .then((nextProducts) => {
        setProducts(nextProducts);
        setStatus("ready");
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        console.error("Medusa catalog is unavailable.", error);
        setStatus("error");
      });

    return () => controller.abort();
  }, []);

  return (
    <CatalogContext.Provider value={{ products, source, status }}>
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
