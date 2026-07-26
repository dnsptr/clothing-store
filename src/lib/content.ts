import {
  CATALOG_REVALIDATE_SECONDS,
  isMedusaConfigured,
  medusaRequest,
} from "./medusa";

/**
 * Editorial content of the home page, authored by the client in Medusa Admin.
 *
 * The storefront treats this as presentation, not merchandise, which is why the
 * failure policy here differs from the catalog's. ADR-001 §6 forbids falling
 * back to the demo catalog because inventing products and prices misleads a
 * shopper. A missing banner misleads nobody, so an unreachable backend renders
 * the affected section as absent rather than taking the whole page down — and
 * ISR keeps serving the last good render in the meantime.
 */
export interface ContentMedia {
  type: "image" | "video";
  url: string;
  posterUrl: string | null;
}

export interface ContentSlide {
  id: string;
  section: "hero" | "shortcut" | "material" | "store" | "promo";
  rank: number;
  title: string;
  eyebrow: string | null;
  subtitle: string | null;
  media: ContentMedia;
  alt: string;
  objectPosition: string | null;
  durationMs: number | null;
  href: string | null;
  ctaLabel: string | null;
}

export interface HomeContent {
  hero: ContentSlide[];
  shortcuts: ContentSlide[];
  materials: ContentSlide[];
  stores: ContentSlide[];
  promo: ContentSlide | null;
}

export const EMPTY_HOME_CONTENT: HomeContent = {
  hero: [],
  shortcuts: [],
  materials: [],
  stores: [],
  promo: null,
};

const slide = (
  section: ContentSlide["section"],
  rank: number,
  values: Partial<ContentSlide> & { title: string; media: ContentMedia },
): ContentSlide => ({
  id: `${section}-${rank}`,
  section,
  rank,
  eyebrow: null,
  subtitle: null,
  alt: "",
  objectPosition: null,
  durationMs: null,
  href: null,
  ctaLabel: null,
  ...values,
});

const image = (url: string): ContentMedia => ({ type: "image", url, posterUrl: null });

/**
 * Home page content for `DATA_MODE=mock`.
 *
 * The storefront has two build targets: the Vercel server build that talks to
 * Medusa, and a static export of the demo that has no backend at all. This is
 * the demo's content — the same copy the components used to hardcode. It is the
 * mock-mode counterpart of MOCK_PRODUCTS, and like the demo size ladder in
 * lib/shop.ts it is a stand-in that must never appear in medusa mode: ADR-001
 * §6 bans presenting fallback data as if it were the client's own.
 */
const HERO_SLIDE_DURATION_MS = 6500;

export const MOCK_HOME_CONTENT: HomeContent = {
  hero: [
    slide("hero", 0, {
      title: "Новинки",
      eyebrow: "Актуальное",
      media: { type: "video", url: "/hero/new-arrivals.mp4", posterUrl: "/images/collection-women.png" },
      alt: "Новая коллекция женской одежды",
      href: "/catalog?section=new",
      objectPosition: "50% 50%",
      durationMs: HERO_SLIDE_DURATION_MS,
    }),
    slide("hero", 1, {
      title: "Одежда",
      eyebrow: "Каталог",
      media: image("/images/collection-women.png"),
      alt: "Женская коллекция одежды",
      href: "/catalog?section=clothing",
      objectPosition: "50% 40%",
      durationMs: HERO_SLIDE_DURATION_MS,
    }),
    slide("hero", 2, {
      title: "Sale до −50%",
      eyebrow: "Специальное предложение",
      media: image("/hero/sale-campaign.png"),
      alt: "Женские образы из специальной подборки",
      href: "/catalog?section=sale",
      objectPosition: "50% 50%",
      durationMs: HERO_SLIDE_DURATION_MS,
    }),
  ],
  shortcuts: [
    slide("shortcut", 0, { title: "Новинки", eyebrow: "Каталог", media: image("/images/collection-women.png"), href: "/catalog?section=new" }),
    slide("shortcut", 1, { title: "Одежда", eyebrow: "Разделы", media: image("/products/1/1-1.jpg"), href: "/catalog?section=clothing" }),
    slide("shortcut", 2, { title: "Обувь", eyebrow: "Разделы", media: image("/products/9/9-1.png"), href: "/catalog?section=shoes" }),
    slide("shortcut", 3, { title: "Аксессуары", eyebrow: "Разделы", media: image("/products/4/4-1.png"), href: "/catalog?section=accessories" }),
  ],
  materials: [
    slide("material", 0, { title: "Лен", eyebrow: "Материалы в деталях", media: image("/products/3/3-1.png"), href: "/catalog?material=linen" }),
    slide("material", 1, { title: "Шелк", eyebrow: "Материалы в деталях", media: image("/products/6/6-1.png"), href: "/catalog?material=silk" }),
    slide("material", 2, { title: "Кашемир", eyebrow: "Материалы в деталях", media: image("/products/2/2-1.png"), href: "/catalog?material=cashmere" }),
    slide("material", 3, { title: "Шерсть", eyebrow: "Материалы в деталях", media: image("/products/5/5-1.png"), href: "/catalog?material=wool" }),
  ],
  stores: [
    slide("store", 0, { title: "Магазин 01", media: image("/images/collection-women.png") }),
    slide("store", 1, { title: "Магазин 02", media: image("/images/hero.png") }),
    slide("store", 2, { title: "Магазин 03", media: image("/products/1/1-1.jpg") }),
    slide("store", 3, { title: "Магазин 04", media: image("/products/5/5-1.png") }),
    slide("store", 4, { title: "Онлайн", media: image("/products/8/8-1.png") }),
  ],
  promo: slide("promo", 0, {
    title: "Современная классика для женщин",
    eyebrow: "MARIO MIKKE",
    media: image("/images/hero.png"),
    alt: "Женская коллекция MARIO MIKKE",
    href: "/info/about",
    ctaLabel: "О бренде",
  }),
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * Drops rows that cannot be rendered instead of throwing.
 *
 * A slide with no media url would render as a broken image on the live home
 * page; skipping it degrades one card rather than the page. The check is
 * deliberately narrow — only what the markup dereferences — so a new optional
 * field added in the admin does not start silently discarding content.
 */
function parseSlide(value: unknown): ContentSlide | null {
  if (!isRecord(value)) return null;

  const media = isRecord(value.media) ? value.media : null;
  const url = typeof media?.url === "string" ? media.url : "";
  const id = typeof value.id === "string" ? value.id : "";
  const title = typeof value.title === "string" ? value.title : "";

  if (!id || !url) return null;

  const str = (key: string) =>
    typeof value[key] === "string" && value[key] !== "" ? (value[key] as string) : null;

  return {
    id,
    section: value.section as ContentSlide["section"],
    rank: typeof value.rank === "number" ? value.rank : 0,
    title,
    eyebrow: str("eyebrow"),
    subtitle: str("subtitle"),
    media: {
      type: media?.type === "video" ? "video" : "image",
      url,
      posterUrl: typeof media?.posterUrl === "string" ? media.posterUrl : null,
    },
    alt: typeof value.alt === "string" ? value.alt : "",
    objectPosition: str("objectPosition"),
    durationMs: typeof value.durationMs === "number" ? value.durationMs : null,
    href: str("href"),
    ctaLabel: str("ctaLabel"),
  };
}

const parseList = (value: unknown): ContentSlide[] =>
  Array.isArray(value)
    ? value.map(parseSlide).filter((slide): slide is ContentSlide => slide !== null)
    : [];

/**
 * Reads the home page content for a server render.
 *
 * Never throws: the home page is the site's entry point, and a content outage
 * must not turn it into an error page. Failures are logged for diagnosis and
 * surface as empty sections, which each component already has to handle because
 * the client can legitimately empty a section from the admin.
 */
export async function fetchHomeContent(): Promise<HomeContent> {
  // Mock mode is the demo build, which has no backend to ask.
  if (!isMedusaConfigured) return MOCK_HOME_CONTENT;

  try {
    const data = await medusaRequest<unknown>("/store/content/home", {
      revalidate: CATALOG_REVALIDATE_SECONDS,
    });

    if (!isRecord(data)) return EMPTY_HOME_CONTENT;

    return {
      hero: parseList(data.hero),
      shortcuts: parseList(data.shortcuts),
      materials: parseList(data.materials),
      stores: parseList(data.stores),
      promo: parseSlide(data.promo),
    };
  } catch (error) {
    console.error("[home] Не удалось загрузить контент главной страницы.", error);
    return EMPTY_HOME_CONTENT;
  }
}
