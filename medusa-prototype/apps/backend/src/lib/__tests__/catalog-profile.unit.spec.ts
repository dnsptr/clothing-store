import { normalizeSize, profileProblems, publicationProfileProblems, readProfile, PROFILE_FIELDS } from "../catalog-profile"

describe("catalog profile", () => {
  it("reports missing descriptions for quality review without blocking publication", () => {
    expect(profileProblems(readProfile({})).length).toBeGreaterThan(0)
    expect(publicationProfileProblems(readProfile({}))).toEqual([])
    expect(publicationProfileProblems(readProfile({ manufactured_at: "13.2026", registry_url: "http://example.com" }))).toHaveLength(2)
  })
  it("preserves an incomplete draft without inventing values", () => {
    expect(readProfile(undefined).manufacturer).toBe("")
    expect(profileProblems(readProfile({}))).toContain("Изготовитель")
  })
  it("normalizes only OS aliases", () => {
    expect(normalizeSize(" os ")).toBe("ONE SIZE")
    expect(normalizeSize("One Size")).toBe("ONE SIZE")
    expect(normalizeSize("XS")).toBe("XS")
  })
  it("checks month, HTTPS and explicit absence of lining", () => {
    const profile = readProfile(Object.fromEntries(PROFILE_FIELDS.map(([key]) => [key, "value"])))
    profile.manufactured_at = "08.2026"; profile.registry_url = "https://example.org/registry"
    profile.no_lining = true; profile.lining = ""
    expect(profileProblems(profile)).toEqual([])
    profile.manufactured_at = "13.2026"; profile.registry_url = "javascript:alert(1)"
    expect(profileProblems(profile)).toHaveLength(2)
  })
})
