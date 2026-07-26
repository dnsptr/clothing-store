import type { ContentSection } from "./models/content-slide"

/**
 * The shape both the admin and the storefront read.
 *
 * Kept in the module rather than in either route so the two cannot drift: the
 * storefront's contract test asserts against this shape, and a field renamed
 * here fails the admin build in the same commit.
 */
export interface PublicSlide {
  id: string
  section: ContentSection
  rank: number
  title: string
  eyebrow: string | null
  subtitle: string | null
  media: { type: "image" | "video"; url: string; posterUrl: string | null }
  alt: string
  objectPosition: string | null
  durationMs: number | null
  href: string | null
  ctaLabel: string | null
}

/** Rows as the module service returns them; only what the mapper touches. */
type SlideRow = {
  id: string
  section: ContentSection
  rank: number
  title: string
  eyebrow: string | null
  subtitle: string | null
  media_type: "image" | "video"
  media_url: string
  poster_url: string | null
  alt: string | null
  object_position: string | null
  duration_ms: number | null
  href: string | null
  cta_label: string | null
}

/**
 * A null `alt` becomes an empty string rather than the title: repeating the
 * visible title in the alt text is noise for a screen reader, and an empty alt
 * is the correct markup for decorative media.
 */
export function toPublicSlide(row: SlideRow): PublicSlide {
  return {
    id: row.id,
    section: row.section,
    rank: row.rank,
    title: row.title,
    eyebrow: row.eyebrow,
    subtitle: row.subtitle,
    media: {
      type: row.media_type,
      url: row.media_url,
      posterUrl: row.poster_url,
    },
    alt: row.alt ?? "",
    objectPosition: row.object_position,
    durationMs: row.duration_ms,
    href: row.href,
    ctaLabel: row.cta_label,
  }
}
