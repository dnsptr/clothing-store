import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { CONTENT_MODULE } from "../../../../modules/content"
import type { ReorderInput } from "../validators"

type ContentService = {
  listContentSlides: (filters?: Record<string, unknown>) => Promise<Record<string, unknown>[]>
  updateContentSlides: (data: Record<string, unknown>[]) => Promise<Record<string, unknown>[]>
}

/**
 * Rewrites the rank of every slide in one section from the order of `ids`.
 *
 * Deliberately not N separate update calls: the storefront reads this table
 * directly, so a partially applied reorder is visible to shoppers. One bulk
 * update keeps the intermediate state out of the database entirely.
 */
export async function POST(
  req: MedusaRequest<ReorderInput>,
  res: MedusaResponse
) {
  const contentService = req.scope.resolve(CONTENT_MODULE) as ContentService
  const { section, ids } = req.validatedBody

  const existing = await contentService.listContentSlides({ section })
  const existingIds = new Set(existing.map((slide) => slide.id as string))

  // Every id must belong to the section being reordered. Without this check a
  // caller could drag a slide's rank from under a different section, and the
  // damage would only show up on the live home page.
  const foreign = ids.filter((id) => !existingIds.has(id))
  if (foreign.length) {
    res.status(400).json({
      type: "invalid_data",
      message: `Slides do not belong to section "${section}": ${foreign.join(", ")}`,
    })
    return
  }

  // A partial list would silently leave the omitted slides at stale ranks that
  // now collide with the new ones.
  if (ids.length !== existing.length) {
    res.status(400).json({
      type: "invalid_data",
      message: `Reorder must list every slide in "${section}": expected ${existing.length}, got ${ids.length}`,
    })
    return
  }

  const slides = await contentService.updateContentSlides(
    ids.map((id, index) => ({ id, rank: index }))
  )

  res.json({ slides })
}
