export interface Product {
  id: string;
  name: string;
  price: number;
  category: string;
  categorySlug: string;
  materialSlugs: string[];
  availableSizes: string[];
  images: string[];
  colors: { name: string; hex: string }[];
  isNew?: boolean;
  isSoldOut?: boolean;
}

export interface Collection {
  id: string;
  title: string;
  subtitle: string;
  image: string;
  link: string;
}

export interface CollectionOutfit {
  id: string;
  title: string;
  subtitle: string;
  image: string;
  productIds: string[];
}

export const MOCK_COLLECTIONS: Collection[] = [
  {
    id: "clothing",
    title: "Одежда",
    subtitle: "Элегантный трикотаж, премиальный лен и шелк",
    image: "/products/1/1-1.jpg", // Use dynamic trench image for clothing cover
    link: "/catalog",
  },
  {
    id: "accessories",
    title: "Аксессуары",
    subtitle: "Кожаные сумки и лаконичная обувь",
    image: "/products/4/4-1.png", // Use bag image for accessories cover (now .png)
    link: "/catalog?category=accessories",
  },
];

export const MOCK_PRODUCTS: Product[] = [
  {
    id: "1",
    name: "Комплект с брюками палаццо и свободным топом",
    price: 19800,
    category: "Пальто и тренчи",
    categorySlug: "outerwear",
    materialSlugs: ["linen"],
    availableSizes: ["XS", "S", "M", "L"],
    images: ["/products/1/1-1.jpg", "/products/1/1-2.jpg", "/products/1/1-3.jpg"],
    colors: [
      { name: "Песочный", hex: "#E1DBD3" },
      { name: "Угольный", hex: "#1C1B1A" },
    ],
    isNew: true,
  },
  {
    id: "2",
    name: "Джемпер с геометрическим узором",
    price: 14500,
    category: "Трикотаж",
    categorySlug: "knitwear",
    materialSlugs: ["cashmere"],
    availableSizes: ["S", "M", "L"],
    images: ["/products/2/2-1.png", "/products/2/2-2.png", "/products/2/2-3.png"],
    colors: [
      { name: "Молочный", hex: "#F3EFE9" },
      { name: "Тауп", hex: "#8E8276" },
    ],
    isNew: true,
  },
  {
    id: "3",
    name: "Юбка макси с принтом пейсли",
    price: 9800,
    category: "Брюки",
    categorySlug: "trousers",
    materialSlugs: ["linen"],
    availableSizes: ["XS", "S", "M"],
    images: ["/products/3/3-1.png", "/products/3/3-2.png", "/products/3/3-3.png"],
    colors: [
      { name: "Светло-бежевый", hex: "#EDEAE4" },
      { name: "Горький шоколад", hex: "#302E2B" },
    ],
  },
  {
    id: "4",
    name: "Сумка-шопер из фактурной кожи",
    price: 22000,
    category: "Аксессуары",
    categorySlug: "accessories",
    materialSlugs: ["leather"],
    availableSizes: [],
    images: ["/products/4/4-1.png", "/products/4/4-2.png", "/products/4/4-3.png"],
    colors: [
      { name: "Шоколад", hex: "#50352A" },
      { name: "Черный", hex: "#1C1B1A" },
    ],
  },
  {
    id: "5",
    name: "Джемпер с коротким рукавом и нагрудным карманом",
    price: 18900,
    category: "Пальто и тренчи",
    categorySlug: "outerwear",
    materialSlugs: ["wool"],
    availableSizes: ["S", "M", "L", "XL"],
    images: ["/products/5/5-1.png", "/products/5/5-2.png", "/products/5/5-3.png"],
    colors: [
      { name: "Песочный", hex: "#E1DBD3" },
      { name: "Шоколад", hex: "#50352A" },
    ],
    isNew: true,
  },
  {
    id: "6",
    name: "Джемпер свободного кроя с коротким рукавом",
    price: 12500,
    category: "Трикотаж",
    categorySlug: "knitwear",
    materialSlugs: ["silk"],
    availableSizes: ["XS", "S", "M"],
    images: ["/products/6/6-1.png", "/products/6/6-2.png", "/products/6/6-3.png"],
    colors: [
      { name: "Молочный", hex: "#F3EFE9" },
      { name: "Черный", hex: "#1C1B1A" },
    ],
  },
  {
    id: "7",
    name: "Юбка миди в клетку",
    price: 11800,
    category: "Брюки",
    categorySlug: "trousers",
    materialSlugs: ["wool"],
    availableSizes: ["S", "M", "L"],
    images: ["/products/7/7-1.png", "/products/7/7-2.png", "/products/7/7-3.png"],
    colors: [
      { name: "Угольный", hex: "#1C1B1A" },
      { name: "Тауп", hex: "#8E8276" },
    ],
  },
  {
    id: "8",
    name: "Комплект с контрастной вышивкой",
    price: 15900,
    category: "Трикотаж",
    categorySlug: "knitwear",
    materialSlugs: ["cotton"],
    availableSizes: ["XS", "S", "M", "L"],
    images: ["/products/8/8-1.png", "/products/8/8-2.png", "/products/8/8-3.png"],
    colors: [
      { name: "Овсяный", hex: "#E2DCD5" },
      { name: "Горький шоколад", hex: "#302E2B" },
    ],
    isNew: true,
  },
  {
    id: "9",
    name: "Платье-кафтан с декоративной вышивкой",
    price: 16500,
    category: "Обувь",
    categorySlug: "shoes",
    materialSlugs: ["leather"],
    availableSizes: [],
    images: ["/products/9/9-1.png", "/products/9/9-2.png", "/products/9/9-3.png"],
    colors: [
      { name: "Черный", hex: "#1C1B1A" },
      { name: "Молочный", hex: "#F3EFE9" },
    ],
  },
  {
    id: "10",
    name: "Платье-кафтан с контрастной отделкой",
    price: 6800,
    category: "Аксессуары",
    categorySlug: "accessories",
    materialSlugs: ["wool", "cashmere"],
    availableSizes: [],
    images: ["/products/10/10-1.png", "/products/10/10-2.png", "/products/10/10-3.png"],
    colors: [
      { name: "Светло-серый", hex: "#DCDCDC" },
      { name: "Песочный", hex: "#E1DBD3" },
    ],
  },
  {
    id: "11",
    name: "Сапоги из фактурной кожи",
    price: 13800,
    category: "Обувь",
    categorySlug: "shoes",
    materialSlugs: ["leather"],
    availableSizes: [],
    images: ["/products/11/11-1.png", "/products/11/11-2.png", "/products/11/11-3.png"],
    colors: [
      { name: "Черный", hex: "#1C1B1A" },
      { name: "Карамель", hex: "#C68E5F" },
    ],
  },
  {
    id: "12",
    name: "Трикотажный костюм с цветочной вышивкой",
    price: 4900,
    category: "Аксессуары",
    categorySlug: "accessories",
    materialSlugs: ["leather"],
    availableSizes: [],
    images: ["/products/12/12-1.png", "/products/12/12-2.png", "/products/12/12-3.png"],
    colors: [
      { name: "Горький шоколад", hex: "#302E2B" },
      { name: "Черный", hex: "#1C1B1A" },
    ],
  },
];

export const MOCK_OUTFITS: CollectionOutfit[] = [
  {
    id: "linen-look",
    title: "Льняной силуэт",
    subtitle: "Летний образ с тренчем и брюками",
    image: "/products/1/1-1.jpg",
    productIds: ["1", "3", "4"],
  },
  {
    id: "cashmere-cozy",
    title: "Теплый трикотаж",
    subtitle: "Кашемировый джемпер и шерстяная юбка",
    image: "/products/2/2-1.png",
    productIds: ["2", "7", "9"],
  },
  {
    id: "autumn-chic",
    title: "Осенний шик",
    subtitle: "Шерстяной жакет с шелковым топом",
    image: "/products/5/5-1.png",
    productIds: ["5", "6", "11"],
  },
];
