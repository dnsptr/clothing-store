import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { readSiteEditor } from "../../../../lib/site-content-editor"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  res.setHeader("Cache-Control", "no-store")
  const { data } = await req.scope.resolve(ContainerRegistrationKeys.QUERY).graph({ entity: "store", fields: ["id", "metadata"], pagination: { take: 2 } })
  if (data.length !== 1) { res.status(503).json({ message: "Контент сайта недоступен" }); return }
  const { published } = readSiteEditor(data[0].metadata ?? {})
  res.json({ content: published?.content ?? null, publicationId: published?.id ?? null, publishedAt: published?.publishedAt ?? null })
}
