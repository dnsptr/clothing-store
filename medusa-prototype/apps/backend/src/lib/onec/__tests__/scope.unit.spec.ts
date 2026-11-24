import { ONEC_CATALOG_ARTICLES, scopeCatalog } from "../scope"
import { CUSTOMER_CATALOG } from "../../../scripts/data/customer-catalog"
import { parseCatalog, parseOffers } from "../preview"

const xml = (body: string) => Buffer.from(`<КоммерческаяИнформация ВерсияСхемы="2.08" ДатаФормирования="2026-01-01T12:00:00">${body}</КоммерческаяИнформация>`)
const catalog = (products: string) => parseCatalog(xml(`<Каталог><Ид>catalog</Ид><Товары>${products}</Товары></Каталог>`))
const offers = (ids: string[]) => parseOffers(xml(`<ПакетПредложений><ИдКаталога>catalog</ИдКаталога><Предложения>${ids.map(id => `<Предложение><Ид>${id}</Ид></Предложение>`).join("")}</Предложения></ПакетПредложений>`))

it("keeps the approved assortment aligned with the original spreadsheet import", () => {
  expect([...ONEC_CATALOG_ARTICLES].sort()).toEqual(CUSTOMER_CATALOG.map(row => row.article).sort())
  expect(new Set(ONEC_CATALOG_ARTICLES).size).toBe(21)
})
it("excludes unrelated products and their offers without changing source objects", () => {
  const source = catalog('<Товар><Ид>yes</Ид><Артикул>1916</Артикул></Товар><Товар><Ид>no</Ид><Артикул>9999</Артикул></Товар>')
  const data = offers(["yes#color", "yes", "no#color", "unknown#color"])
  const before = JSON.stringify({ source, data })
  const result = scopeCatalog(source, data)
  expect(result.catalog.products.map(row => row.id)).toEqual(["yes"])
  expect(result.offers.offers.map(row => row.id)).toEqual(["yes#color", "yes"])
  expect(result.scope.missingArticles).toHaveLength(20)
  expect(result.scope.excludedProducts).toBe(1)
  expect(result.scope.excludedOffers).toBe(2)
  expect(JSON.stringify({ source, data })).toBe(before)
})
it("reports a complete export only when all approved articles are present", () => {
  const source = catalog(ONEC_CATALOG_ARTICLES.map(article => `<Товар><Ид>${article}</Ид><Артикул>${article}</Артикул></Товар>`).join(""))
  expect(scopeCatalog(source, offers([])).scope.missingArticles).toEqual([])
})
