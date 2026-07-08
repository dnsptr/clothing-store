export interface Product {
  id: string;
  name: string;
  price: number;
  category: string;
  images: string[];
  colors: { name: string; hex: string }[];
  gender: "women" | "men" | "unisex";
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
    id: "women",
    title: "Женская коллекция",
    subtitle: "Элегантный трикотаж, премиальный лен и шелк",
    image: "/images/collection-women.png",
    link: "/catalog?gender=women",
  },
  {
    id: "men",
    title: "Мужская коллекция",
    subtitle: "Безупречный крой, тонкая шерсть и кашемир",
    image: "/images/collection-men.png",
    link: "/catalog?gender=men",
  },
];

export const MOCK_PRODUCTS: Product[] = [
  {
    id: "1",
    name: "Классический льняной тренч",
    price: 19800,
    category: "Пальто и тренчи",
    images: ["/images/product-trench.png", "/images/product-trench-2.png"],
    colors: [
      { name: "Песочный", hex: "#E1DBD3" },
      { name: "Угольный", hex: "#1C1B1A" },
    ],
    gender: "women",
    isNew: true,
  },
  {
    id: "2",
    name: "Джемпер крупной вязки из кашемира",
    price: 14500,
    category: "Трикотаж",
    images: ["/images/product-knitwear.png", "/images/product-knitwear-2.png"],
    colors: [
      { name: "Молочный", hex: "#F3EFE9" },
      { name: "Тауп", hex: "#8E8276" },
    ],
    gender: "women",
    isNew: true,
  },
  {
    id: "3",
    name: "Льняные брюки прямого кроя",
    price: 9800,
    category: "Брюки",
    images: ["/images/product-trousers.png", "/images/product-trousers-2.png"],
    colors: [
      { name: "Светло-бежевый", hex: "#EDEAE4" },
      { name: "Горький шоколад", hex: "#302E2B" },
    ],
    gender: "women",
  },
  {
    id: "4",
    name: "Кожаная сумка-шопер на плечо",
    price: 22000,
    category: "Аксессуары",
    images: ["/images/product-bag.png", "/images/product-bag-2.png"],
    colors: [
      { name: "Шоколад", hex: "#50352A" },
      { name: "Черный", hex: "#1C1B1A" },
    ],
    gender: "unisex",
    isSoldOut: false,
  },
  {
    id: "5",
    name: "Шерстяное пальто классического кроя",
    price: 26000,
    category: "Верхняя одежда",
    images: ["/images/collection-men.png"],
    colors: [
      { name: "Угольный", hex: "#303030" },
    ],
    gender: "men",
    isNew: true,
  },
  {
    id: "6",
    name: "Джемпер из ультратонкого кашемира",
    price: 16800,
    category: "Трикотаж",
    images: ["/images/product-knitwear.png"],
    colors: [
      { name: "Тауп", hex: "#8E8276" },
    ],
    gender: "men",
  },
];
