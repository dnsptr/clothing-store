export type CustomerCatalogRow = {
  article: string
  name: string
  price?: number
  colors?: string
  composition?: string
  manufacturerAddress: string
  conformityDocument?: string
  category: "knitwear" | "skirts"
}

const shared = {
  size: "ONE SIZE",
  country: "Россия",
  manufacturer: "ИП Заманов Рауф Рафикович",
  care: "Стирка 30 °C, не отбеливать, гладить при температуре до 150 °C, разрешена химическая чистка кроме трихлорэтилена, не использовать машинный отжим.",
  brand: "Mario Mikke",
  noLining: true,
} as const

export const CUSTOMER_CATALOG = [
  { article: "1351", name: "Кофта женская", price: 3990, colors: "бежевый, белый, бирюзовый, бордовый, голубой, горчичный, джинсовый, капучино, коричневый, кремовый, лён, светло пудровый, тёмно-серый. Тёмно-синий, тёмно шоколадный, хаки, черный. Шоколадный", composition: "70% шерсть, 30% акрил", manufacturerAddress: "Москва, проспект Вернадского, 92, кв. 402", conformityDocument: "ЕАЭС N RU Д-RU.РА08.В.70517/25", category: "knitwear" },
  { article: "1603", name: "Кофта женская", price: 3990, colors: "баклажановый, бирюзовый, бордовый, голубой, джинсовый, кораловый, коричневый, кремовый, лимонный, молочный, мятный, оранжевый, светло-коричневый, светло-серый, сиреневый, тёмно-бордовый, тёмно-синий, хаки, черный", composition: "100% хлопок", manufacturerAddress: "Москва, проспект Вернадского, 92, кв. 405", conformityDocument: "ЕАЭС N RU Д-RU.РА08.В.70517/25", category: "knitwear" },
  { article: "1647", name: "Кофта женская", price: 3990, colors: "белый, бордовый, голубой, джинсовый, капучино, кремовый, оранжевый, серый, тёмно-синий, фиолетовый, щоколадный", composition: "100% хлопок", manufacturerAddress: "Москва, проспект Вернадского, 92, кв. 404", conformityDocument: "ЕАЭС N RU Д-RU.РА08.В.70517/25", category: "knitwear" },
  { article: "1760", name: "Кофта женская", price: 3990, manufacturerAddress: "Москва, проспект Вернадского, 92, кв. 403", category: "knitwear" },
  { article: "2015", name: "Кардиган женский", price: 5990, colors: "бежевый, коричневый, светло-бежевый, синий, тёмно-синий", composition: "70% шерсть, 30% акрил", manufacturerAddress: "Москва, проспект Вернадского, 92, кв. 406", conformityDocument: "ЕАЭС N RU Д-RU.РА08.В.70517/25", category: "knitwear" },
  { article: "1857-1", name: "Кофта женская", price: 3990, colors: "белый, бордовый, голубой, джинсовый, коричневый, красный, лимонный, оранжевый, светло-бежевый, тёмно-коричневый, тёмно-синий, хаки. Черный", composition: "100% хлопок", manufacturerAddress: "Москва, проспект Вернадского, 92, кв. 407", conformityDocument: "ЕАЭС N RU Д-RU.РА08.В.70517/25", category: "knitwear" },
  { article: "1453-1", name: "Кофта женская", price: 1990, colors: "бежевый, белый, какао, коричневый, светло-бежый, черный", composition: "70% шерсть, 30% акрил", manufacturerAddress: "Москва, проспект Вернадского, 92, кв. 408", conformityDocument: "ЕАЭС N RU Д-RU.РА08.В.70517/25", category: "knitwear" },
  { article: "1994", name: "Кофта женская", price: 3990, colors: "бежевый, белый, джинсовый, светло-бежевый, тёмно-коричневый", composition: "70% шерсть, 30% акрил", manufacturerAddress: "Москва, проспект Вернадского, 92, кв. 409", conformityDocument: "ЕАЭС N RU Д-RU.РА08.В.70517/25", category: "knitwear" },
  { article: "2018", name: "Юбка женская", colors: "белый, коричневый, светло-бежевый, черный", composition: "70% шерсть, 30% акрил", manufacturerAddress: "Москва, проспект Вернадского, 92, кв. 410", conformityDocument: "ЕАЭС N RU Д-RU.РА08.В.70517/25", category: "skirts" },
  { article: "1812", name: "Кофта женская", price: 3990, colors: "бежевый, молочный", composition: "70% шерсть, 30% акрил", manufacturerAddress: "Москва, проспект Вернадского, 92, кв. 411", conformityDocument: "ЕАЭС N RU Д-RU.РА08.В.70517/25", category: "knitwear" },
  { article: "4262", name: "Юбка женская", colors: "Разноцветный", composition: "50% вискоза, 50% полиэстер", manufacturerAddress: "Москва, проспект Вернадского, 92, кв. 412", conformityDocument: "ЕАЭС N RU Д-RU.РА01.В.52642/26", category: "skirts" },
  { article: "1856-1", name: "Кофта женская", price: 3990, colors: "бежевый/коричневый, бежевый/черный, белый/голубой, белый/тёмно-синий, кремовый/бирюзовый, кремовый/бордовый, кремовый/кэмел, светло-бежевый/хаки", composition: "100% хлопок", manufacturerAddress: "Москва, проспект Вернадского, 92, кв. 413", conformityDocument: "ЕАЭС N RU Д-RU.РА08.В.70517/25", category: "knitwear" },
  { article: "1730", name: "Кардиган длинный женский", price: 7990, colors: "бежевый, белый, светло-бежевый, фиолетовый", composition: "50% шерсть, 50% акрил", manufacturerAddress: "Москва, проспект Вернадского, 92, кв. 414", conformityDocument: "ЕАЭС N RU Д-RU.РА08.В.70517/25", category: "knitwear" },
  { article: "2014", name: "Кардиган длинный женский", colors: "коричневый/светло-бежевый, светло-бежевый/голубой", composition: "70% шерсть, 30% акрил", manufacturerAddress: "Москва, проспект Вернадского, 92, кв. 415", conformityDocument: "ЕАЭС N RU Д-RU.РА08.В.70517/25", category: "knitwear" },
  { article: "1999", name: "Кардиган женский", price: 8500, colors: "бежевый, голубой, горчичный, коричневый, светло-бежевый, серый, тёмно-синий, хаки", composition: "70% шерсть, 30% акрил", manufacturerAddress: "Москва, проспект Вернадского, 92, кв. 416", conformityDocument: "ЕАЭС N RU Д-RU.РА08.В.70517/25", category: "knitwear" },
  { article: "1917", name: "Кофта женская", price: 3990, colors: "бежевый/белый, бордовый/белый, голубой/белый, джинсовый/белый, капучино/светло-беж, коричневый/кремовый, серый/белый, тёмно-синий/белый", composition: "100% хлопок", manufacturerAddress: "Москва, проспект Вернадского, 92, кв. 417", conformityDocument: "ЕАЭС N RU Д-RU.РА08.В.70517/25", category: "knitwear" },
  { article: "1592", name: "Кофта женская", price: 3990, colors: "бежевый, бордовый, джинсовый, капучино, коричневый, кофе, кремовый, лён, молочный, светло-бежевый, темно-бежевый, тёмно-горчичный, тёмно-синий", composition: "70% шерсть, 30% акрил", manufacturerAddress: "Москва, проспект Вернадского, 92, кв. 418", conformityDocument: "ЕАЭС N RU Д-RU.РА08.В.70517/25", category: "knitwear" },
  { article: "1897", name: "Кофта женская", price: 3990, colors: "бежевый/кремовый, голубой/белый, джиновый/белый, зелёный/бежевый, коричневый/светло-бежевый, оранжевый/светло-бежевый, светло бежевый/хаки, тёмно синий/белый, темно кофейный/кремовый", composition: "100% хлопок", manufacturerAddress: "Москва, проспект Вернадского, 92, кв. 419", conformityDocument: "ЕАЭС N RU Д-RU.РА08.В.70517/25", category: "knitwear" },
  { article: "1916", name: "Юбка длинная женская", price: 3990, colors: "бордовый, голубой, капучино, коричневый, молочный, светло бежевый, тёмно-синий, черный", composition: "70% шерсть, 30% акрил", manufacturerAddress: "Москва, проспект Вернадского, 92, кв. 420", conformityDocument: "ЕАЭС N RU Д-RU.РА08.В.70517/25", category: "skirts" },
  { article: "1301", name: "Юбка длинная плиссе женская", price: 2990, colors: "бежевый, белый, бордовый, голубой, кремовый, лён, молочный, серый, сиреневый, тёмно-синий, черный, шоколадный", composition: "50% шерсть, 30% вискоза, 10% эластан, 10% акрил", manufacturerAddress: "Москва, проспект Вернадского, 92, кв. 421", conformityDocument: "ЕАЭС N RU Д-RU.РА08.В.70517/25", category: "skirts" },
  { article: "2016", name: "Кардиган женский", price: 5690, colors: "Разноцветный", composition: "70% шерсть, 30% акрил", manufacturerAddress: "Москва, проспект Вернадского, 92, кв. 422", conformityDocument: "ЕАЭС N RU Д-RU.РА08.В.70517/25", category: "knitwear" },
] satisfies CustomerCatalogRow[]

export const CUSTOMER_CATALOG_SHARED = shared

export function parseCustomerColors(value?: string): string[] {
  if (!value?.trim()) return []
  const seen = new Set<string>()
  return value.replace(/\./g, ",").split(",").map(color => color.trim()).filter(color => {
    if (!color || seen.has(color.toLocaleLowerCase("ru"))) return false
    seen.add(color.toLocaleLowerCase("ru")); return true
  })
}

export function customerVariantSku(article: string, colorIndex: number): string {
  return `MM-${article.toUpperCase()}-OS-${String(colorIndex + 1).padStart(2, "0")}`
}

export function indexStableCustomerVariants<T extends { sku?: string | null; title?: string | null }>(
  handle: string,
  desired: readonly { sku: string; title: string }[],
  existing: readonly T[],
): Map<string, T> {
  const bySku = new Map<string, T>()
  for (const variant of existing) if (variant.sku) bySku.set(variant.sku, variant)
  for (const variant of desired) {
    const current = bySku.get(variant.sku)
    if (current && current.title !== variant.title) {
      throw new Error(`${handle}: SKU ${variant.sku} принадлежит варианту "${current.title}", а в таблице "${variant.title}". Изменение соответствия SKU и цвета запрещено`)
    }
  }
  return bySku
}
