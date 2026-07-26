export interface CatalogLink {
  label: string;
  href: string;
}

export interface CatalogCard extends CatalogLink {
  eyebrow: string;
  image: string;
}

export interface CatalogCategory extends CatalogLink {
  slug: string;
  section: "clothing" | "shoes" | "accessories";
}

export interface CatalogMaterial extends CatalogCard {
  slug: string;
}

export const CATALOG_SECTIONS = {
  new: {
    label: "Новинки",
    href: "/catalog?section=new",
  },
  clothing: {
    label: "Одежда",
    href: "/catalog?section=clothing",
  },
  shoes: {
    label: "Обувь",
    href: "/catalog?section=shoes",
  },
  accessories: {
    label: "Сумки и аксессуары",
    href: "/catalog?section=accessories",
  },
} as const satisfies Record<string, CatalogLink>;

export const PRODUCT_CATEGORIES: CatalogCategory[] = [
  {
    slug: "outerwear",
    label: "Пальто и тренчи",
    section: "clothing",
    href: "/catalog?category=outerwear",
  },
  {
    slug: "knitwear",
    label: "Трикотаж",
    section: "clothing",
    href: "/catalog?category=knitwear",
  },
  {
    slug: "trousers",
    label: "Брюки",
    section: "clothing",
    href: "/catalog?category=trousers",
  },
  {
    slug: "shoes",
    label: "Обувь",
    section: "shoes",
    href: "/catalog?category=shoes",
  },
  {
    slug: "accessories",
    label: "Аксессуары",
    section: "accessories",
    href: "/catalog?category=accessories",
  },
];

export const CLOTHING_CATEGORIES: CatalogLink[] = [
  { label: "Все товары", href: CATALOG_SECTIONS.clothing.href },
  ...PRODUCT_CATEGORIES.filter((category) => category.section === "clothing"),
  { label: "Платья", href: "/catalog?category=knitwear" },
];

export const SHOES_CATEGORIES: CatalogLink[] = [
  { label: "Вся обувь", href: CATALOG_SECTIONS.shoes.href },
  { label: "Лоферы", href: "/catalog?category=shoes" },
  { label: "Босоножки", href: "/catalog?category=shoes" },
];

export const SALE_CATEGORIES: CatalogLink[] = [
  { label: "До 30%", href: "/catalog?section=sale" },
  { label: "До 50%", href: "/catalog?section=sale" },
  { label: "Трикотаж", href: "/catalog?category=knitwear" },
  { label: "Аксессуары", href: "/catalog?category=accessories" },
  { label: "Все акции", href: "/catalog?section=sale" },
];

export const MATERIALS: CatalogMaterial[] = [
  {
    slug: "linen",
    label: "Лен",
    eyebrow: "Материалы в деталях",
    image: "/products/3/3-1.png",
    href: "/catalog?material=linen",
  },
  {
    slug: "silk",
    label: "Шелк",
    eyebrow: "Материалы в деталях",
    image: "/products/6/6-1.png",
    href: "/catalog?material=silk",
  },
  {
    slug: "cashmere",
    label: "Кашемир",
    eyebrow: "Материалы в деталях",
    image: "/products/2/2-1.png",
    href: "/catalog?material=cashmere",
  },
  {
    slug: "wool",
    label: "Шерсть",
    eyebrow: "Материалы в деталях",
    image: "/products/5/5-1.png",
    href: "/catalog?material=wool",
  },
];

export const CATALOG_PRIMARY_NAV: CatalogLink[] = [
  CATALOG_SECTIONS.new,
  CATALOG_SECTIONS.clothing,
  CATALOG_SECTIONS.shoes,
  CATALOG_SECTIONS.accessories,
];

export const HOME_RECOMMENDATIONS: CatalogCard[] = [
  {
    label: "Новинки",
    eyebrow: "Каталог",
    image: "/images/collection-women.png",
    href: CATALOG_SECTIONS.new.href,
  },
  {
    label: "Одежда",
    eyebrow: "Разделы",
    image: "/products/1/1-1.jpg",
    href: CATALOG_SECTIONS.clothing.href,
  },
  {
    label: "Обувь",
    eyebrow: "Разделы",
    image: "/products/9/9-1.png",
    href: CATALOG_SECTIONS.shoes.href,
  },
  {
    label: "Аксессуары",
    eyebrow: "Разделы",
    image: "/products/4/4-1.png",
    href: CATALOG_SECTIONS.accessories.href,
  },
];

export const CLOTHING_SECTION_CATEGORY_SLUGS = ["outerwear", "knitwear", "trousers"];

export function getCategoryBySlug(slug: string) {
  return PRODUCT_CATEGORIES.find((category) => category.slug === slug);
}

export function getMaterialBySlug(slug: string) {
  return MATERIALS.find((material) => material.slug === slug);
}

export function getCatalogTitle(params: {
  category?: string | null;
  material?: string | null;
  section?: string | null;
}) {
  if (params.category) {
    return getCategoryBySlug(params.category)?.label ?? params.category;
  }

  if (params.material) {
    return getMaterialBySlug(params.material)?.label ?? "Материалы";
  }

  if (params.section === "new") return "Новинки";
  if (params.section === "clothing") return "Одежда";
  if (params.section === "shoes") return "Обувь";
  if (params.section === "accessories") return "Сумки и аксессуары";
  if (params.section === "sale") return "Sale";

  return "Каталог";
}
