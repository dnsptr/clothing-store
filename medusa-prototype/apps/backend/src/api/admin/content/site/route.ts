import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { ILockingModule } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { updateStoresWorkflow } from "@medusajs/medusa/core-flows"
import { mutateSiteEditor, readSiteEditor, SiteEditorConflict, type SiteEditorCommand } from "../../../../lib/site-content-editor"
import { SiteContentValidationError } from "../../../../lib/site-content-contract"

async function store(req: AuthenticatedMedusaRequest) {
  const { data } = await req.scope.resolve(ContainerRegistrationKeys.QUERY).graph({ entity: "store", fields: ["id", "metadata"], pagination: { take: 2 } })
  if (data.length !== 1) throw new Error("Expected one storefront store")
  return data[0] as { id: string; metadata: Record<string, unknown> | null }
}
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  res.setHeader("Cache-Control", "no-store")
  const current = await store(req)
  res.json({ ...readSiteEditor(current.metadata ?? {}), storefrontUrl: process.env.STOREFRONT_URL ?? "" })
}
export async function POST(req: AuthenticatedMedusaRequest<SiteEditorCommand>, res: MedusaResponse) {
  res.setHeader("Cache-Control", "no-store")
  try {
    const current = await store(req)
    const locking = req.scope.resolve<ILockingModule>(Modules.LOCKING)
    const state = await mutateSiteEditor({
      load: async () => (await store(req)).metadata ?? {},
      save: metadata => updateStoresWorkflow(req.scope).run({ input: { selector: { id: current.id }, update: { metadata } } }),
      locked: operation => locking.execute(`site-content:${current.id}`, operation, { timeout: 30 }),
    }, req.validatedBody, req.auth_context.actor_id)
    res.json(state)
  } catch (error) {
    if (error instanceof SiteEditorConflict) { res.status(409).json({ message: error.message }); return }
    if (error instanceof SiteContentValidationError) { res.status(400).json({ message: error.message }); return }
    throw error
  }
}
