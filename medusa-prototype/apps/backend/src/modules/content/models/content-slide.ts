import { model } from "@medusajs/framework/utils"

/**
 * Editable content of the storefront home page.
 *
 * Every editorial surface on the home page is the same shape underneath: a
 * picture, a couple of lines of text, and a link. Hero slides, the category
 * shortcuts, the material cards and the store cards differ only in where they
 * are rendered, so they share one model discriminated by `section` rather than
 * getting a model — and an admin screen — each. The client edits them all in
 * one place, and adding a sixth surface later costs a new enum value, not a new
 * migration.
 *
 * `promo` is the one section the storefront renders as a singleton. Nothing in
 * the model enforces that: the store API takes the lowest-ranked active row and
 * ignores the rest, which keeps "swap the banner" a matter of reordering rather
 * than deleting the current one.
 */
export const CONTENT_SECTIONS = [
  "hero",
  "shortcut",
  "material",
  "store",
  "promo",
] as const

export type ContentSection = (typeof CONTENT_SECTIONS)[number]

const ContentSlide = model.define("ContentSlide", {
  id: model.id({ prefix: "cslide" }).primaryKey(),

  // Spread on purpose: `model.enum` takes a mutable array, and CONTENT_SECTIONS
  // is a readonly tuple so it can also serve as the source of the union type.
  section: model.enum([...CONTENT_SECTIONS]),

  /**
   * Ascending display order within a section. Not unique on purpose — the admin
   * reorders by rewriting ranks in bulk, and a unique index would make every
   * intermediate state of that rewrite a constraint violation.
   */
  rank: model.number().default(0),

  /** Hidden rows stay editable in the admin but never reach the storefront. */
  is_active: model.boolean().default(true),

  title: model.text(),
  /** Small line above the title ("Актуальное", "Материалы в деталях"). */
  eyebrow: model.text().nullable(),
  /** Second line, used by the promo banner only. */
  subtitle: model.text().nullable(),

  media_type: model.enum(["image", "video"]).default("image"),

  /**
   * Absolute URL the storefront renders.
   *
   * `media_key` is the file provider's own key for the same asset. Storing both
   * is what keeps the eventual local→S3 migration a configuration change: the
   * key survives the provider swap, the URL does not. Rows whose media is a
   * static path shipped in the storefront's /public (the hero video, until it
   * moves to object storage) carry a URL and no key.
   */
  media_url: model.text(),
  media_key: model.text().nullable(),

  /** Poster frame for `media_type: "video"`. */
  poster_url: model.text().nullable(),
  poster_key: model.text().nullable(),

  /** Empty string is legitimate: decorative media should not be announced. */
  alt: model.text().nullable(),

  /** CSS object-position, for art direction on wide crops. */
  object_position: model.text().nullable(),

  /** Slide duration in the hero rotation. Null falls back to the UI default. */
  duration_ms: model.number().nullable(),

  href: model.text().nullable(),
  cta_label: model.text().nullable(),

  metadata: model.json().nullable(),
})

export default ContentSlide
