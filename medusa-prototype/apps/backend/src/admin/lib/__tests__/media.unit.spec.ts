import { resolveMediaPreviewUrl } from "../media"

describe("resolveMediaPreviewUrl", () => {
  it("resolves storefront assets against the storefront origin", () => {
    expect(
      resolveMediaPreviewUrl("/images/hero.png", "https://www.mariomikke.shop/")
    ).toBe("https://www.mariomikke.shop/images/hero.png")
  })

  it("leaves uploaded absolute URLs unchanged", () => {
    const url = "https://api.mariomikke.shop/static/hero.png"

    expect(resolveMediaPreviewUrl(url, "https://www.mariomikke.shop")).toBe(url)
  })

  it("keeps a relative URL usable when the storefront origin is unavailable", () => {
    expect(resolveMediaPreviewUrl("/images/hero.png", "")).toBe("/images/hero.png")
  })
})
