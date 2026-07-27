import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { CONTENT_MODULE } from "../../../../modules/content"
import type { CreateSlideInput } from "../validators"

type ContentService = {
  listContentSlides: (
    filters?: Record<string, unknown>,
    config?: Record<string, unknown>
  ) => Promise<Record<string, unknown>[]>
  createContentSlides: (data: Record<string, unknown>) => Promise<Record<string, unknown>>
}

/**
 * Lists every slide, including inactive ones — the admin has to be able to see
 * and re-enable what it has hidden, which the storefront endpoint deliberately
 * cannot.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const contentService = req.scope.resolve(CONTENT_MODULE) as ContentService
  const { section } = req.query as { section?: string }

  const slides = await contentService.listContentSlides(
    section ? { section } : {},
    { order: { section: "ASC", rank: "ASC" } }
  )

  res.json({ slides })
}

export async function POST(
  req: MedusaRequest<CreateSlideInput>,
  res: MedusaResponse
) {
  const contentService = req.scope.resolve(CONTENT_MODULE) as ContentService
  const body = req.validatedBody

  /**
   * A new slide lands at the end of its section unless the caller says
   * otherwise. Appending is what the admin form does; asking the editor to
   * pick a rank for a first slide would be a question with no good answer.
   */
  let rank = body.rank
  if (rank === undefined) {
    const existing = await contentService.listContentSlides(
      { section: body.section },
      { order: { rank: "DESC" }, take: 1 }
    )
    const highest = existing[0]?.rank
    rank = typeof highest === "number" ? highest + 1 : 0
  }

  const slide = await contentService.createContentSlides({ ...body, rank })

  res.status(201).json({ slide })
}
