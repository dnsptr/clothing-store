import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { CONTENT_MODULE } from "../../../../../modules/content"
import type { UpdateSlideInput } from "../../validators"

type ContentService = {
  retrieveContentSlide: (id: string) => Promise<Record<string, unknown>>
  updateContentSlides: (data: Record<string, unknown>) => Promise<Record<string, unknown>>
  deleteContentSlides: (ids: string | string[]) => Promise<void>
}

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const contentService = req.scope.resolve(CONTENT_MODULE) as ContentService
  const slide = await contentService.retrieveContentSlide(req.params.id)

  res.json({ slide })
}

/**
 * Update. POST rather than PATCH to match the convention the rest of the Medusa
 * admin API uses, so the dashboard's own fetch helpers work unchanged.
 */
export async function POST(
  req: MedusaRequest<UpdateSlideInput>,
  res: MedusaResponse
) {
  const contentService = req.scope.resolve(CONTENT_MODULE) as ContentService

  // Retrieve first so a bad id is a 404 rather than an update that silently
  // affects nothing.
  await contentService.retrieveContentSlide(req.params.id)

  const slide = await contentService.updateContentSlides({
    id: req.params.id,
    ...req.validatedBody,
  })

  res.json({ slide })
}

export async function DELETE(req: MedusaRequest, res: MedusaResponse) {
  const contentService = req.scope.resolve(CONTENT_MODULE) as ContentService

  await contentService.retrieveContentSlide(req.params.id)
  await contentService.deleteContentSlides(req.params.id)

  res.json({ id: req.params.id, object: "content_slide", deleted: true })
}
