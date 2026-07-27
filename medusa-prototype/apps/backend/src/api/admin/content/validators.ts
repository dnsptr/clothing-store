import { z } from "zod"

import { CONTENT_SECTIONS } from "../../../modules/content"

/**
 * A URL the storefront can actually render: either an absolute http(s) url (an
 * upload served by the file provider) or a root-relative path (an asset shipped
 * in the storefront's /public, which is still where the hero video lives).
 *
 * Rejecting everything else here is what keeps a typo from reaching the live
 * home page as a broken image.
 */
const renderableUrl = z
  .string()
  .min(1)
  .refine(
    (value) => value.startsWith("/") || /^https?:\/\//.test(value),
    "Must be an absolute http(s) URL or a root-relative path starting with /"
  )

/**
 * `.nullish()` rather than `.optional()` throughout: the admin form sends null
 * to clear a field, and an omitted key must mean "leave unchanged" on update.
 * Those are different intents and the route handler distinguishes them.
 */
export const CreateSlideSchema = z.object({
  section: z.enum(CONTENT_SECTIONS),
  rank: z.number().int().min(0).optional(),
  is_active: z.boolean().optional(),

  title: z.string().min(1, "Заголовок обязателен"),
  eyebrow: z.string().nullish(),
  subtitle: z.string().nullish(),

  media_type: z.enum(["image", "video"]).optional(),
  media_url: renderableUrl,
  media_key: z.string().nullish(),
  poster_url: renderableUrl.nullish(),
  poster_key: z.string().nullish(),

  alt: z.string().nullish(),
  object_position: z.string().nullish(),
  duration_ms: z.number().int().positive().nullish(),

  href: z.string().nullish(),
  cta_label: z.string().nullish(),
  metadata: z.record(z.string(), z.unknown()).nullish(),
})

export const UpdateSlideSchema = CreateSlideSchema.partial()

/**
 * Reordering is its own endpoint rather than a series of updates: the admin
 * rewrites every rank in a section at once, and doing that as N separate
 * requests would leave the live home page in a half-reordered state between
 * them.
 */
export const ReorderSchema = z.object({
  section: z.enum(CONTENT_SECTIONS),
  ids: z.array(z.string().min(1)).min(1),
})

export type CreateSlideInput = z.infer<typeof CreateSlideSchema>
export type UpdateSlideInput = z.infer<typeof UpdateSlideSchema>
export type ReorderInput = z.infer<typeof ReorderSchema>
