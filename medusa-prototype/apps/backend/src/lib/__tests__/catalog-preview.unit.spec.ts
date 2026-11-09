import { assertPurchasableVariants } from "../catalog-preview"

const container = (data: unknown[]) => ({ resolve: () => ({ graph: jest.fn().mockResolvedValue({ data }) }) }) as never

describe("preview purchase protection", () => {
  it("rejects preview items even when inventory would allow purchase", async () => {
    await expect(assertPurchasableVariants(container([{ id: "v1", product: { metadata: { storefront_preview: true } } }]), ["v1"]))
      .rejects.toThrow("только для просмотра")
  })
  it("permits regular products", async () => {
    await expect(assertPurchasableVariants(container([{ id: "v1", product: { metadata: {} } }]), ["v1"])).resolves.toBeUndefined()
  })
  it("rejects previously added demo products after they are unpublished", async () => {
    await expect(assertPurchasableVariants(container([{ id: "v1", product: { status: "rejected", metadata: {} } }]), ["v1"]))
      .rejects.toThrow("снят с публикации")
  })
  it("propagates database failures instead of permitting a purchase", async () => {
    const failed = { resolve: () => ({ graph: jest.fn().mockRejectedValue(new Error("offline")) }) } as never
    await expect(assertPurchasableVariants(failed, ["v1"])).rejects.toThrow("offline")
  })
})
