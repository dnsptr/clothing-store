import type { Product } from "./product";

export interface BreadcrumbItem {
  label: string;
  href?: string;
}

export function catalogBreadcrumbs(title = "Каталог"): BreadcrumbItem[] {
  return [
    { label: "Главная", href: "/" },
    ...(title === "Каталог"
      ? [{ label: "Каталог" }]
      : [{ label: "Каталог", href: "/catalog" }, { label: title }]),
  ];
}

export function productBreadcrumbs(product?: Pick<Product, "name" | "category" | "categorySlug">): BreadcrumbItem[] {
  const category = product?.category.trim();
  const slug = product?.categorySlug.trim();
  return [
    { label: "Главная", href: "/" },
    { label: "Каталог", href: "/catalog" },
    ...(category && slug && slug !== "catalog"
      ? [{ label: category, href: `/catalog?category=${encodeURIComponent(slug)}` }]
      : []),
    { label: product?.name ?? "Товар" },
  ];
}
