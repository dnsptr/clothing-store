import { CUSTOMER_CATALOG, customerVariantSku, parseCustomerColors } from "../customer-catalog"

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
})
