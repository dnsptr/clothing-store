import { MedusaContainer } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { CONTENT_MODULE } from "../modules/content"
import type { ContentSection } from "../modules/content"

/**
 * Seeds the home page with the content the storefront used to hardcode.
 *
 * This exists so the migration away from hardcoded components is not a visible
 * regression: the moment the components start reading from the database, the
 * database must already contain what they used to render. Media paths point at
 * assets shipped in the storefront's /public — they stay valid until the client
 * replaces them through the admin, and until then nothing has to be uploaded.
 *
 * Idempotent by `(section, title)`: re-running does not duplicate rows and does
 * not overwrite anything the client has since edited. Seeding is a one-way door
 * on purpose — after the client owns this content, a re-run must not silently
 * revert their work.
 */

type SeedSlide = {
  section: ContentSection
  title: string
  eyebrow?: string
  subtitle?: string
  media_type?: "image" | "video"
  media_url: string
  poster_url?: string
  alt?: string
  object_position?: string
  duration_ms?: number
  href?: string
  cta_label?: string
}

const HERO_DURATION_MS = 6500

const SEED: SeedSlide[] = [
  // src/components/Hero.tsx → HERO_SLIDES
  {
    section: "hero",
    title: "Новинки",
    eyebrow: "Актуальное",
    media_type: "video",
    media_url: "/hero/new-arrivals.mp4",
    poster_url: "/images/collection-women.png",
    alt: "Новая коллекция женской одежды",
    href: "/catalog?section=new",
    object_position: "50% 50%",
    duration_ms: HERO_DURATION_MS,
  },
  {
    section: "hero",
    title: "Одежда",
    eyebrow: "Каталог",
    media_url: "/images/collection-women.png",
    alt: "Женская коллекция одежды",
    href: "/catalog?section=clothing",
    object_position: "50% 40%",
    duration_ms: HERO_DURATION_MS,
  },
  {
    section: "hero",
    title: "Sale до −50%",
    eyebrow: "Специальное предложение",
    media_url: "/hero/sale-campaign.png",
    alt: "Женские образы из специальной подборки",
    href: "/catalog?section=sale",
    object_position: "50% 50%",
    duration_ms: HERO_DURATION_MS,
  },

  // src/lib/catalog.ts → HOME_RECOMMENDATIONS
  {
    section: "shortcut",
    title: "Новинки",
    eyebrow: "Каталог",
    media_url: "/images/collection-women.png",
    href: "/catalog?section=new",
  },
  {
    section: "shortcut",
    title: "Одежда",
    eyebrow: "Разделы",
    media_url: "/products/1/1-1.jpg",
    href: "/catalog?section=clothing",
  },
  {
    section: "shortcut",
    title: "Обувь",
    eyebrow: "Разделы",
    media_url: "/products/9/9-1.png",
    href: "/catalog?section=shoes",
  },
  {
    section: "shortcut",
    title: "Аксессуары",
    eyebrow: "Разделы",
    media_url: "/products/4/4-1.png",
    href: "/catalog?section=accessories",
  },

  // src/lib/catalog.ts → MATERIALS
  {
    section: "material",
    title: "Лен",
    eyebrow: "Материалы в деталях",
    media_url: "/products/3/3-1.png",
    href: "/catalog?material=linen",
  },
  {
    section: "material",
    title: "Шелк",
    eyebrow: "Материалы в деталях",
    media_url: "/products/6/6-1.png",
    href: "/catalog?material=silk",
  },
  {
    section: "material",
    title: "Кашемир",
    eyebrow: "Материалы в деталях",
    media_url: "/products/2/2-1.png",
    href: "/catalog?material=cashmere",
  },
  {
    section: "material",
    title: "Шерсть",
    eyebrow: "Материалы в деталях",
    media_url: "/products/5/5-1.png",
    href: "/catalog?material=wool",
  },

  // src/components/StoresSlider.tsx → STORES
  { section: "store", title: "Магазин 01", media_url: "/images/collection-women.png" },
  { section: "store", title: "Магазин 02", media_url: "/images/hero.png" },
  { section: "store", title: "Магазин 03", media_url: "/products/1/1-1.jpg" },
  { section: "store", title: "Магазин 04", media_url: "/products/5/5-1.png" },
  { section: "store", title: "Онлайн", media_url: "/products/8/8-1.png" },

  // src/components/PromoBanner.tsx
  {
    section: "promo",
    title: "Современная классика для женщин",
    eyebrow: "MARIO MIKKE",
    media_url: "/images/hero.png",
    alt: "Женская коллекция MARIO MIKKE",
    href: "/info/about",
    cta_label: "О бренде",
  },
]

type ExecArgs = {
  container: MedusaContainer
  args: string[]
}

type ContentService = {
  listContentSlides: (
    filters?: Record<string, unknown>
  ) => Promise<{ section: string; title: string }[]>
  createContentSlides: (data: Record<string, unknown>[]) => Promise<unknown[]>
}

export default async function seedHomeContent({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const contentService = container.resolve(CONTENT_MODULE) as ContentService

  const existing = await contentService.listContentSlides({})
  const seen = new Set(existing.map((row) => `${row.section}::${row.title}`))

  const missing = SEED.filter((slide) => !seen.has(`${slide.section}::${slide.title}`))

  if (!missing.length) {
    logger.info(
      `Home content already seeded (${existing.length} slides present). Nothing to do.`
    )
    return
  }

  // Rank continues after whatever each section already holds, so seeding a
  // partially populated section appends rather than colliding with the
  // client's ordering.
  const nextRank = new Map<string, number>()
  for (const row of existing) {
    nextRank.set(row.section, (nextRank.get(row.section) ?? -1) + 1)
  }

  const payload = missing.map((slide) => {
    const rank = (nextRank.get(slide.section) ?? -1) + 1
    nextRank.set(slide.section, rank)

    return {
      section: slide.section,
      rank,
      is_active: true,
      title: slide.title,
      eyebrow: slide.eyebrow ?? null,
      subtitle: slide.subtitle ?? null,
      media_type: slide.media_type ?? "image",
      media_url: slide.media_url,
      media_key: null,
      poster_url: slide.poster_url ?? null,
      poster_key: null,
      alt: slide.alt ?? null,
      object_position: slide.object_position ?? null,
      duration_ms: slide.duration_ms ?? null,
      href: slide.href ?? null,
      cta_label: slide.cta_label ?? null,
    }
  })

  await contentService.createContentSlides(payload)

  logger.info(
    `Seeded ${payload.length} home content slides ` +
      `(${existing.length} already present and left untouched).`
  )
}
