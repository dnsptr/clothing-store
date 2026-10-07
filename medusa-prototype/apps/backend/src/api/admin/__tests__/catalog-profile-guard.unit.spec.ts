import { catalogProfileGuard } from "../catalog-profile-guard"
import { PROFILE_FIELDS } from "../../../lib/catalog-profile"

async function check(body: Record<string, unknown>, current?: Record<string, unknown>) {
  const next = jest.fn()
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn() }
  const req = { body, params: current ? { id: "prod_1" } : {}, scope: { resolve: () => ({ graph: async () => ({ data: current ? [current] : [] }) }) } }
  await catalogProfileGuard(req as never, res as never, next)
  return { next, res }
}
function publishable(images = [{ url: "https://example.org/photo.jpg" }]) {
  const profile = Object.fromEntries(PROFILE_FIELDS.map(([key]) => [key, "filled"]))
  profile.manufactured_at = "08.2026"; profile.registry_url = "https://example.org/registry"
  return { status: "published", title: "Product", metadata: { catalog_profile: profile },
    images, categories: [{ id: "pcat_1" }],
    variants: [{ prices: [{ currency_code: "rub", amount: 1990 }] }],
  }
}

describe("publication guard", () => {
  it("rejects invalid measurements even on drafts", async () => {
    const result = await check({ status: "draft", metadata: { catalog_profile: { measurements: [{ size: "S", label: "Length", value: "-5" }] } } })
    expect(result.res.status).toHaveBeenCalledWith(400)
    expect(result.next).not.toHaveBeenCalled()
  })
  it("allows a complete card with a priced variant", async () => {
    expect((await check(publishable())).next).toHaveBeenCalled()
  })
  it("rejects publication with the customer-import placeholder, including persisted images", async () => {
    const placeholder = [{ url: "https://shop.example/images/product-placeholder.webp" }]
    const creation = await check(publishable(placeholder))
    expect(creation.res.status).toHaveBeenCalledWith(400)
    expect(creation.next).not.toHaveBeenCalled()
    const update = await check({ status: "published" }, { ...publishable(placeholder), status: "draft" })
    expect(update.res.status).toHaveBeenCalledWith(400)
    expect(update.next).not.toHaveBeenCalled()
    expect((await check(publishable([...placeholder, { url: "https://shop.example/photo.webp" }]))).next).toHaveBeenCalled()
  })
  it("allows incomplete drafts", async () => {
    expect((await check({ status: "draft", metadata: { catalog_profile: {} } })).next).toHaveBeenCalled()
  })
  it("rejects incomplete publication through the standard admin route", async () => {
    const result = await check({ status: "published", metadata: { catalog_profile: {} } })
    expect(result.res.status).toHaveBeenCalledWith(400)
    expect(result.next).not.toHaveBeenCalled()
  })
  it("does not block ordinary legacy edits without a managed profile", async () => {
    expect((await check({ title: "Changed" }, { status: "published" })).next).toHaveBeenCalled()
  })
  it("requires the template for explicit publication from native admin", async () => {
    expect((await check({ status: "published" })).res.status).toHaveBeenCalledWith(400)
  })
  it("prevents clearing metadata to bypass the guard", async () => {
    const result = await check({ metadata: null }, { metadata: { catalog_profile: {} }, status: "published" })
    expect(result.res.status).toHaveBeenCalledWith(400)
  })
})
