import { CUSTOMER_CATALOG, customerVariantSku, parseCustomerColors } from "../customer-catalog"

describe("customer catalog source", () => {
  it("contains one unique row for every customer article", () => {
    expect(CUSTOMER_CATALOG).toHaveLength(21)
    expect(new Set(CUSTOMER_CATALOG.map(row => row.article)).size).toBe(21)
    expect(CUSTOMER_CATALOG.find(row => row.article === "1453-1")).toBeDefined()
    expect(CUSTOMER_CATALOG.find(row => row.article === "1857-1")).toBeDefined()
  })
  it("includes the prices and characteristics supplied in the updated workbook", () => {
    expect(CUSTOMER_CATALOG.every(row => row.price && row.price > 0)).toBe(true)
    expect(CUSTOMER_CATALOG.find(row => row.article === "2018")?.price).toBe(6400)
    expect(parseCustomerColors(CUSTOMER_CATALOG.find(row => row.article === "1760")?.colors)).toHaveLength(2)
    expect(CUSTOMER_CATALOG.find(row => row.article === "1760")?.composition).toBe("70% шерсть, 30% акрил")
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
})
