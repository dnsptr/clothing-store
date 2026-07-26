import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { CONTENT_MODULE } from "../../../../modules/content"
import { toPublicSlide, type PublicSlide } from "../../../../modules/content/dto"
import type { ContentSection } from "../../../../modules/content/models/content-slide"

/**
 * Everything the storefront home page needs, in one request.
 *
 * One round trip rather than one per section: the page renders all of it at
 * once, and a partial failure would produce a half-built home page that is
 * worse than a clean error state.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const contentService = req.scope.resolve(CONTENT_MODULE) as {
    listContentSlides: (
      filters?: Record<string, unknown>,
      config?: Record<string, unknown>
    ) => Promise<Parameters<typeof toPublicSlide>[0][]>
  }

  const rows = await contentService.listContentSlides(
    { is_active: true },
    { order: { rank: "ASC" } }
  )

  const bySection = rows.reduce<Record<string, PublicSlide[]>>((acc, row) => {
    ;(acc[row.section] ??= []).push(toPublicSlide(row))
    return acc
  }, {})

  const section = (name: ContentSection) => bySection[name] ?? []

  res.json({
    hero: section("hero"),
    shortcuts: section("shortcut"),
    materials: section("material"),
    stores: section("store"),
    // Rendered as a singleton. Extra rows stay addressable in the admin, so
    // swapping the banner is a reorder rather than a delete-and-recreate.
    promo: section("promo")[0] ?? null,
  })
}
