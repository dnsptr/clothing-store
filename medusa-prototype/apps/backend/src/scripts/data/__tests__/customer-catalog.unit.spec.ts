import { CUSTOMER_CATALOG, customerVariantSku, indexStableCustomerVariants, parseCustomerColors } from "../customer-catalog"

describe("customer catalog source", () => {
  it("contains one unique row for every customer article", () => {
    expect(CUSTOMER_CATALOG).toHaveLength(21)
    expect(new Set(CUSTOMER_CATALOG.map(row => row.article)).size).toBe(21)
    expect(CUSTOMER_CATALOG.find(row => row.article === "1453-1")).toBeDefined()
    expect(CUSTOMER_CATALOG.find(row => row.article === "1857-1")).toBeDefined()
  })
  it("keeps missing customer data missing", () => {
    expect(CUSTOMER_CATALOG.filter(row => row.price === undefined).map(row => row.article)).toEqual(["2018", "4262", "2014"])
    const incomplete = CUSTOMER_CATALOG.find(row => row.article === "1760")
    expect(incomplete?.colors).toBeUndefined()
    expect(incomplete?.composition).toBeUndefined()
  })
  it("splits punctuation-delimited colors without duplicates", () => {
    expect(parseCustomerColors("хаки. Черный, хаки")).toEqual(["хаки", "Черный"])
    expect(parseCustomerColors(undefined)).toEqual([])
  })
  it("creates stable unique temporary variant SKUs", () => {
    const skus = CUSTOMER_CATALOG.flatMap(row => parseCustomerColors(row.colors).map((_, index) => customerVariantSku(row.article, index)))
    expect(new Set(skus).size).toBe(skus.length)
    expect(customerVariantSku("1453-1", 0)).toBe("MM-1453-1-OS-01")
  })
  it("rejects reassigning an existing SKU after a color reorder or insertion", () => {
    const existing = [
      { id: "white", sku: customerVariantSku("1453-1", 0), title: "ONE SIZE / белый" },
      { id: "black", sku: customerVariantSku("1453-1", 1), title: "ONE SIZE / черный" },
    ]
    for (const colors of ["черный, белый", "бежевый, белый, черный"]) {
      const desired = parseCustomerColors(colors).map((color, index) => ({
        sku: customerVariantSku("1453-1", index), title: `ONE SIZE / ${color}`,
      }))
      expect(() => indexStableCustomerVariants("mario-mikke-1453-1", desired, existing))
        .toThrow(/SKU MM-1453-1-OS-01.*Изменение соответствия SKU и цвета запрещено/)
    }
  })
  it("retains variant identities when the existing order is unchanged and colors are appended", () => {
    const existing = [{ id: "white", sku: customerVariantSku("1453-1", 0), title: "ONE SIZE / белый" }]
    const desired = parseCustomerColors("белый, черный").map((color, index) => ({
      sku: customerVariantSku("1453-1", index), title: `ONE SIZE / ${color}`,
    }))
    const indexed = indexStableCustomerVariants("mario-mikke-1453-1", desired, existing)
    expect(indexed.get(desired[0].sku)?.id).toBe("white")
    expect(indexed.has(desired[1].sku)).toBe(false)
  })
})
