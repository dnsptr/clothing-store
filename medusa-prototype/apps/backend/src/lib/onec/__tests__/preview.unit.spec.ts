import { buildPreview, parseCatalog, parseOffers, type StoreProduct } from "../preview"

const envelope = (body: string, date = "2026-01-01T12:00:00") => Buffer.from(`<КоммерческаяИнформация xmlns="urn:1C.ru:commerceml_210" ВерсияСхемы="2.08" ДатаФормирования="${date}">${body}</КоммерческаяИнформация>`)
const catalogXml = () => envelope('<Каталог><Ид>catalog-a</Ид><ИдКлассификатора>classifier-a</ИдКлассификатора><Владелец><ИНН>private-owner-data</ИНН></Владелец><Товары><Товар><Ид>product-a</Ид><Артикул>DEMO-A</Артикул><Наименование>Товар</Наименование></Товар></Товары></Каталог>')
const offerXml = (id = "product-a#variant-a", color = "светло-бежевый", size = "One size", quantity = "-2") => `<Предложение><Ид>${id}</Ид><Наименование>Товар</Наименование><ХарактеристикиТовара><ХарактеристикаТовара><Наименование>Цвет (Одежда маркируемая)</Наименование><Значение>${color}</Значение></ХарактеристикаТовара><ХарактеристикаТовара><Наименование>Размер RU (Одежда маркируемая)</Наименование><Значение>${size}</Значение></ХарактеристикаТовара></ХарактеристикиТовара><Цены><Цена><ИдТипаЦены>retail</ИдТипаЦены><ЦенаЗаЕдиницу>3990.00</ЦенаЗаЕдиницу><Валюта>руб</Валюта><Коэффициент>1</Коэффициент><Единица>шт</Единица></Цена></Цены><Количество>${quantity}</Количество><Склад ИдСклада="warehouse-a" КоличествоНаСкладе="${quantity}"/></Предложение>`
const offersXml = (offers = offerXml()) => envelope(`<ПакетПредложений><ИдКаталога>catalog-a</ИдКаталога><ИдКлассификатора>classifier-a</ИдКлассификатора><ТипыЦен><ТипЦены><Ид>retail</Ид><Наименование>Розничная цена</Наименование><Валюта>руб</Валюта></ТипЦены></ТипыЦен><Склады><Склад><Ид>warehouse-a</Ид><Наименование>Тестовый склад</Наименование></Склад></Склады><Предложения>${offers}</Предложения></ПакетПредложений>`)
function product(): StoreProduct {
  return { id: "store-product", title: "Название сайта", status: "published", metadata: { catalog_profile: { model: "DEMO-A" } }, options: [{ id: "color", title: "Цвет" }, { id: "size", title: "Размер" }], variants: [{ id: "store-variant", title: "OS / светло бежевый", sku: "STORE-SKU", options: [{ option_id: "color", value: "светло бежевый" }, { option_id: "size", value: "ONE SIZE" }], price_set: { prices: [{ currency_code: "rub", amount: 3990 }] } }] }
}
const preview = (offers = offersXml(), products = [product()]) => buildPreview(parseCatalog(catalogXml()), parseOffers(offers), products)

it("parses only required catalog fields, not private owner data", () => {
  expect(JSON.stringify(parseCatalog(catalogXml()))).not.toContain("private-owner-data")
  expect(parseOffers(offersXml()).offers[0].stocks[0]).toEqual({ warehouseId: "warehouse-a", quantity: "-2" })
})
it("proposes a unique article/color/size candidate without mutating inputs or aggregating stock", () => {
  const products = [product()]
  const before = JSON.stringify(products)
  const report = preview(offersXml(), products)
  expect(report.summary.candidates).toBe(1)
  expect(report.rows[0].target?.variantId).toBe("store-variant")
  expect(report.rows[0].price).toEqual({ currency: "rub", incoming: 3990, current: 3990, changed: false })
  expect(report.rows[0].proposedQuantity).toBeNull()
  expect(report.rows[0].warnings).toContain("negative_quantity")
  expect(report.warehouses[0].eligible).toBe(false)
  expect(report.appliesChanges).toBe(false)
  expect(JSON.stringify(products)).toBe(before)
})
it("does not merge similar characteristics with different 1C IDs", () => {
  const report = preview(offersXml(offerXml() + offerXml("product-a#variant-b", "СВЕТЛО БЕЖЕВЫЙ")))
  expect(report.summary.ambiguous).toBe(2)
  expect(report.rows.every(row => row.target === null)).toBe(true)
})
it("separates the parent offer and missing variant", () => {
  const report = preview(offersXml('<Предложение><Ид>product-a</Ид></Предложение>' + offerXml("product-a#white-m", "БЕЛЫЙ", "M")))
  expect(report.summary.parent).toBe(1)
  expect(report.summary.missing).toBe(1)
})
it("blocks ambiguous products, duplicate IDs and duplicate target variants", () => {
  expect(preview(offersXml(), [product(), { ...product(), id: "other-product" }]).summary.ambiguous).toBe(1)
  expect(preview(offersXml(offerXml() + offerXml())).summary.ambiguous).toBe(2)
  const target = product()
  target.variants!.push({ ...target.variants![0], id: "other-variant" })
  expect(preview(offersXml(), [target]).summary.ambiguous).toBe(1)
})
it("uses an explicit existing ID binding before article matching", () => {
  const target = product()
  target.metadata = { onec_product_id: "product-a" }
  target.variants![0].metadata = { onec_offer_id: "product-a#variant-a" }
  expect(preview(offersXml(), [target]).summary.linked).toBe(1)
})
it("rejects mixing catalogs or different exchange timestamps", () => {
  const catalog = parseCatalog(catalogXml())
  const offers = parseOffers(offersXml())
  expect(() => buildPreview(catalog, { ...offers, catalogId: "other" }, [])).toThrow()
  expect(() => buildPreview(catalog, { ...offers, generatedAt: "2026-01-02T12:00:00" }, [])).toThrow()
})
it("does not use a parent price for its variants", () => {
  const source = offersXml('<Предложение><Ид>product-a</Ид></Предложение>' + offerXml().replace("<ЦенаЗаЕдиницу>3990.00</ЦенаЗаЕдиницу>", "<ЦенаЗаЕдиницу>5500</ЦенаЗаЕдиницу>"))
  expect(preview(source).rows[1].price).toEqual({ currency: "rub", incoming: 5500, current: 3990, changed: true })
})
it("flags an existing ID binding whose dimensions no longer agree", () => {
  const target = product()
  target.variants![0].metadata = { onec_offer_id: "product-a#variant-a" }
  target.variants![0].options![0].value = "красный"
  const row = preview(offersXml(), [target]).rows[0]
  expect(row.status).toBe("ambiguous")
  expect(row.warnings).toContain("bound_dimensions_differ")
})
it("recognizes a bound duplicate with a separate display label and still detects manual label changes", () => {
  const target = product()
  target.variants![0].options![0].value = "светло бежевый (вариант 2)"
  target.variants![0].metadata = { onec_offer_id: "product-a#variant-a", onec_color: "светло-бежевый", onec_size: "One size", onec_display_color: "светло бежевый (вариант 2)", onec_display_size: "ONE SIZE" }
  expect(preview(offersXml(), [target]).rows[0].status).toBe("linked")
  target.variants![0].options![0].value = "белый"
  expect(preview(offersXml(), [target]).rows[0].warnings).toContain("bound_dimensions_differ")
})
it("does not guess prices with multiple price types or quantity tiers", () => {
  const data = parseOffers(offersXml())
  data.priceTypes.push({ id: "wholesale", name: "Other", currency: "rub" })
  expect(buildPreview(parseCatalog(catalogXml()), data, [product()]).rows[0].price.incoming).toBeNull()
  const target = product()
  target.variants![0].price_set!.prices![0].min_quantity = 2
  expect(preview(offersXml(), [target]).rows[0].price.current).toBeNull()
})
it("ignores rejected demo products and never falls back to variant title parsing", () => {
  expect(preview(offersXml(), [{ ...product(), status: "rejected" }]).summary.missing).toBe(1)
  const target = product()
  target.variants![0].options = []
  expect(preview(offersXml(), [target]).summary.missing).toBe(1)
})
