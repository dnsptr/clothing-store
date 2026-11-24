jest.mock("@medusajs/framework/utils", () => ({ ContainerRegistrationKeys: { QUERY: "query" } }))
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { GET } from "../route"
import { mutateSiteEditor, SITE_CONTENT_KEY } from "../../../../../lib/site-content-editor"
import defaults from "../../../../../data/site-content-defaults.json"

it("returns only published content, never the draft, history, author or other store metadata", async () => {
  let metadata: Record<string, unknown> = { private: "DO_NOT_LEAK" }
  const dependencies = { load: async () => metadata, save: async (next: Record<string, unknown>) => { metadata = next }, locked: <T>(action: () => Promise<T>) => action() }
  await mutateSiteEditor(dependencies, { action: "publish", revision: 0 }, "PRIVATE_AUTHOR")
  const content = JSON.parse(JSON.stringify(defaults)); content.footer.contactText = "PRIVATE_DRAFT"
  await mutateSiteEditor(dependencies, { action: "save", revision: 1, content }, "PRIVATE_AUTHOR")
  const res = { setHeader: jest.fn(), status: jest.fn().mockReturnThis(), json: jest.fn() }
  await GET({ scope: { resolve: () => ({ graph: async () => ({ data: [{ metadata }] }) }) } } as unknown as MedusaRequest, res as unknown as MedusaResponse)
  const body = res.json.mock.calls[0][0]
  expect(body.content).toEqual(defaults)
  expect(JSON.stringify(body)).not.toMatch(/DO_NOT_LEAK|PRIVATE_AUTHOR|PRIVATE_DRAFT|history|site_content_editor/)
  expect(res.setHeader).toHaveBeenCalledWith("Cache-Control", "no-store")
  expect(metadata[SITE_CONTENT_KEY]).toBeDefined()
})
