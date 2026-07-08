export interface Product {
  id: string;
  name: string;
  price: number;
  category: string;
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
    image: "/products/4/4-1.jpg", // Use bag image for accessories cover
    link: "/catalog?category=Аксессуары",
  },
];

export const MOCK_PRODUCTS: Product[] = [
  {
    id: "1",
    name: "Классический льняной тренч",
    price: 19800,
    category: "Пальто и тренчи",
    images: ["/products/1/1-1.jpg", "/products/1/1-2.jpg", "/products/1/1-3.jpg"],
    colors: [
      { name: "Песочный", hex: "#E1DBD3" },
      { name: "Угольный", hex: "#1C1B1A" },
    ],
    isNew: true,
  },
  {
    id: "2",
    name: "Джемпер крупной вязки из кашемира",
    price: 14500,
    category: "Трикотаж",
    images: ["/products/2/2-1.jpg", "/products/2/2-2.jpg", "/products/2/2-3.jpg"],
    colors: [
      { name: "Молочный", hex: "#F3EFE9" },
      { name: "Тауп", hex: "#8E8276" },
    ],
    isNew: true,
  },
  {
    id: "3",
    name: "Льняные брюки прямого кроя",
    price: 9800,
    category: "Брюки",
    images: ["/products/3/3-1.jpg", "/products/3/3-2.jpg", "/products/3/3-3.jpg"],
    colors: [
      { name: "Светло-бежевый", hex: "#EDEAE4" },
      { name: "Горький шоколад", hex: "#302E2B" },
    ],
  },
  {
    id: "4",
    name: "Кожаная сумка-шопер на плечо",
    price: 22000,
    category: "Аксессуары",
    images: ["/products/4/4-1.jpg", "/products/4/4-2.jpg", "/products/4/4-3.jpg"],
    colors: [
      { name: "Шоколад", hex: "#50352A" },
      { name: "Черный", hex: "#1C1B1A" },
    ],
  },
  {
    id: "5",
    name: "Шерстяной оверсайз жакет",
    price: 18900,
    category: "Пальто и тренчи",
    images: ["/products/5/5-1.jpg", "/products/5/5-2.jpg", "/products/5/5-3.jpg"],
    colors: [
      { name: "Песочный", hex: "#E1DBD3" },
      { name: "Шоколад", hex: "#50352A" },
    ],
    isNew: true,
  },
  {
    id: "6",
    name: "Шелковый топ на тонких бретелях",
    price: 12500,
    category: "Трикотаж",
    images: ["/products/6/6-1.jpg", "/products/6/6-2.jpg", "/products/6/6-3.jpg"],
    colors: [
      { name: "Молочный", hex: "#F3EFE9" },
      { name: "Черный", hex: "#1C1B1A" },
    ],
  },
  {
    id: "7",
    name: "Шерстяная юбка миди с разрезом",
    price: 11800,
    category: "Брюки",
    images: ["/products/7/7-1.jpg", "/products/7/7-2.jpg", "/products/7/7-3.jpg"],
    colors: [
      { name: "Угольный", hex: "#1C1B1A" },
      { name: "Тауп", hex: "#8E8276" },
    ],
  },
  {
    id: "8",
    name: "Платье-миди из хлопкового трикотажа",
    price: 15900,
    category: "Трикотаж",
    images: ["/products/8/8-1.jpg", "/products/8/8-2.jpg", "/products/8/8-3.jpg"],
    colors: [
      { name: "Овсяный", hex: "#E2DCD5" },
      { name: "Горький шоколад", hex: "#302E2B" },
    ],
    isNew: true,
  },
  {
    id: "9",
    name: "Кожаные лоферы на тонкой подошве",
    price: 16500,
    category: "Обувь",
    images: ["/products/9/9-1.jpg", "/products/9/9-2.jpg", "/products/9/9-3.jpg"],
    colors: [
      { name: "Черный", hex: "#1C1B1A" },
      { name: "Молочный", hex: "#F3EFE9" },
    ],
  },
  {
    id: "10",
    name: "Шерстяной палантин крупной вязки",
    price: 6800,
    category: "Аксессуары",
    images: ["/products/10/10-1.jpg", "/products/10/10-2.jpg", "/products/10/10-3.jpg"],
    colors: [
      { name: "Светло-серый", hex: "#DCDCDC" },
      { name: "Песочный", hex: "#E1DBD3" },
    ],
  },
  {
    id: "11",
    name: "Кожаные босоножки на ремешках",
    price: 13800,
    category: "Обувь",
    images: ["/products/11/11-1.jpg", "/products/11/11-2.jpg", "/products/11/11-3.jpg"],
    colors: [
      { name: "Черный", hex: "#1C1B1A" },
      { name: "Карамель", hex: "#C68E5F" },
    ],
  },
  {
    id: "12",
    name: "Кожаный ремень с лаконичной пряжкой",
    price: 4900,
    category: "Аксессуары",
    images: ["/products/12/12-1.jpg", "/products/12/12-2.jpg", "/products/12/12-3.jpg"],
    colors: [
      { name: "Горький шоколад", hex: "#302E2B" },
      { name: "Черный", hex: "#1C1B1A" },
    ],
  },
];
