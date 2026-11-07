import { MOCK_OUTFITS, type CollectionOutfit } from "../data/mockData";
import { storefrontDataMode } from "./medusa";

const media = (article: string, frame = 1) =>
  `https://api.mariomikke.shop/static/catalog/2026-11/${article}-${frame}.webp`;

export const CUSTOMER_OUTFITS: CollectionOutfit[] = [
  {
    id: "everyday-knitwear",
    title: "Трикотаж на каждый день",
    subtitle: "Свободные силуэты, мягкие фактуры и любимые оттенки",
    image: media("1351"),
    productIds: ["1351", "1603", "1647", "1760", "1857-1", "1453-1", "1994", "1812", "1856-1", "1917", "1592", "1897"],
  },
  {
    id: "cardigans",
    title: "Кардиганы",
    subtitle: "Лаконичные модели и уютные длинные кардиганы",
    image: media("2015"),
    productIds: ["2015", "1730", "2014", "1999", "2016"],
  },
  {
    id: "skirts",
    title: "Юбки",
    subtitle: "Трикотаж, плиссе и выразительные принты",
    image: media("1916", 2),
    productIds: ["2018", "4262", "1916", "1301"],
  },
];

export const STOREFRONT_OUTFITS = storefrontDataMode === "mock" ? MOCK_OUTFITS : CUSTOMER_OUTFITS;
