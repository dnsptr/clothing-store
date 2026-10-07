import { applyProfileTemplate, catalogQuality, measurementProblems, readMeasurements } from "../catalog-quality"
import { readProfile } from "../catalog-profile"

describe("catalog preparation", () => {
  it("allows absent measurements without inventing numbers", () => {
    expect(readMeasurements(undefined)).toEqual([])
    expect(measurementProblems(undefined)).toEqual([])
    expect(measurementProblems([])).toEqual([])
  })
  it("normalizes size and decimal comma", () => {
    const rows = [{ size: "os", label: " Длина ", value: "65,5" }]
    expect(readMeasurements(rows)).toEqual([{ size: "ONE SIZE", label: "Длина", value: "65.5" }])
    expect(measurementProblems(rows)).toEqual([])
  })
  it("rejects invalid values, duplicates and oversized input", () => {
    expect(measurementProblems([{ size: "S", label: "Длина", value: "0" }])).toHaveLength(1)
    expect(measurementProblems([{ size: "S", label: "Длина", value: "-1" }])).toHaveLength(1)
    expect(measurementProblems([{ size: "S", label: "Длина", value: "1001" }])).toHaveLength(1)
    const row = { size: "OS", label: "Длина", value: "65" }
    expect(measurementProblems([row, { ...row, size: "One Size" }])).toHaveLength(1)
    expect(measurementProblems(Array(101).fill(row))).toHaveLength(1)
    expect(measurementProblems([null])).toHaveLength(1)
  })
  it("copies only common fields and keeps identity and batch fields", () => {
    const target = readProfile({ model: "NEW", brand: "Current", manufactured_at: "09.2026", conformity_document: "Own certificate" })
    const source = { model: "OLD", brand: "Source", country: "Китай", manufactured_at: "01.2025", conformity_document: "Other", label_images: ["private"], measurements: ["other"] }
    const copied = applyProfileTemplate(target, source)
    expect(copied.brand).toBe("Current")
    expect(copied.country).toBe("Китай")
    expect(copied.model).toBe("NEW")
    expect(copied.manufactured_at).toBe("09.2026")
    expect(copied.conformity_document).toBe("Own certificate")
    expect(copied).not.toHaveProperty("measurements")
    expect(applyProfileTemplate(target, source, true).brand).toBe("Source")
  })
  it("treats lining and no-lining as one field", () => {
    const target = readProfile({ lining: "Cotton" })
    expect(applyProfileTemplate(target, { no_lining: true }).lining).toBe("Cotton")
    expect(applyProfileTemplate(target, { no_lining: true }, true)).toMatchObject({ lining: "", no_lining: true })
  })
  it("reports missing information and checks every variant's RUB price", () => {
    expect(catalogQuality({})).toMatchObject({ noPrice: true, noPhotos: true, noComposition: true, noMeasurements: true })
    const product = { variants: [{ price_set: { prices: [{ currency_code: "rub", amount: 1990 }] } }, { prices: [{ currency_code: "usd", amount: 20 }] }] }
    expect(catalogQuality(product).noPrice).toBe(true)
    expect(catalogQuality({ variants: [product.variants[0]] }).noPrice).toBe(false)
  })
  it("reports imported placeholder images as missing until a real photo is uploaded", () => {
    const placeholder = { url: "https://shop.example/images/product-placeholder.webp?cache=1" }
    expect(catalogQuality({ images: [placeholder] }).noPhotos).toBe(true)
    expect(catalogQuality({ images: [placeholder, { url: "https://shop.example/photo.webp" }] }).noPhotos).toBe(false)
  })
})
