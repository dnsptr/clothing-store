import type { Metadata } from "next";
import { Cormorant_Garamond, Inter } from "next/font/google";
import { CartProvider } from "@/context/CartContext";
import { CatalogProvider } from "@/context/CatalogContext";
import MenuDrawer from "@/components/MenuDrawer";
import RouteScrollReset from "@/components/RouteScrollReset";
import "./globals.css";

const cormorant = Cormorant_Garamond({
  variable: "--font-cormorant",
  subsets: ["latin", "cyrillic"],
  weight: ["300", "400", "500", "600", "700"],
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin", "cyrillic"],
  weight: ["300", "400", "500", "600"],
});

export const metadata: Metadata = {
  title: "Mario Mikke | Premium Clothing Store",
  description: "Minimalist and elegant online clothing store by Mario Mikke",
  applicationName: "Mario Mikke",
  openGraph: {
    title: "Mario Mikke | Premium Clothing Store",
    description: "Minimalist and elegant online clothing store by Mario Mikke",
    siteName: "Mario Mikke",
    locale: "ru_RU",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Mario Mikke | Premium Clothing Store",
    description: "Minimalist and elegant online clothing store by Mario Mikke",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru" className={`${cormorant.variable} ${inter.variable}`}>
      <body>
        <CatalogProvider>
          <CartProvider>
            <RouteScrollReset />
            {children}
            <MenuDrawer />
          </CartProvider>
        </CatalogProvider>
      </body>
    </html>
  );
}
