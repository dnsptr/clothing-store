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
  if (!isMedusaConfigured) return EMPTY_HOME_CONTENT;

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
