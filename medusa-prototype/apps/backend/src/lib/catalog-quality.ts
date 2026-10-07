import { profileProblems, readProfile, normalizeSize, type CatalogProfile } from "./catalog-profile"

export type Measurement = { size: string; label: string; value: string }
export function readMeasurements(value: unknown): Measurement[] {
  if (!Array.isArray(value)) return []
  return value.map((row) => ({
    size: typeof row?.size === "string" ? normalizeSize(row.size) : "",
    label: typeof row?.label === "string" ? row.label.trim() : "",
    value: typeof row?.value === "string" ? row.value.trim().replace(",", ".") : "",
  }))
}

export function measurementProblems(value: unknown): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > 100) return ["Обмеры: не более 100 строк"]
  const seen = new Set<string>()
  return readMeasurements(value).flatMap((row, i) => {
    const key = `${row.size.toLowerCase()}|${row.label.toLowerCase()}`
    const duplicate = seen.has(key)
    seen.add(key)
    return !row.size || row.size.length > 50 || !row.label || row.label.length > 80 ||
      !/^\d+(\.\d{1,2})?$/.test(row.value) || Number(row.value) <= 0 || Number(row.value) > 1000 || duplicate
      ? [`Обмеры, строка ${i + 1}: размер, уникальное измерение и значение от 0 до 1000 см (не включая 0)`] : []
  })
}

const TEMPLATE_KEYS = ["composition", "country", "manufacturer", "manufacturer_address", "care", "brand"] as const
export function applyProfileTemplate(target: CatalogProfile, source: unknown, overwrite = false): CatalogProfile {
  const template = readProfile(source)
  const next = { ...target }
  for (const key of TEMPLATE_KEYS) {
    if (template[key].trim() && (overwrite || !next[key].trim())) next[key] = template[key]
  }
  if ((overwrite || (!next.lining.trim() && !next.no_lining)) && (template.no_lining || template.lining.trim())) {
    next.no_lining = template.no_lining
    next.lining = template.no_lining ? "" : template.lining
  }
  return next
}

export interface QualityProduct {
  title?: string; metadata?: Record<string, unknown> | null
  images?: unknown[]; categories?: unknown[]
  variants?: { prices?: { currency_code: string; amount: number }[]; price_set?: { prices?: { currency_code: string; amount: number }[] } }[]
}
// The customer catalog importer deliberately uses this image until merchant photos arrive.
export function hasRealProductImage(images: readonly unknown[] | null | undefined): boolean {
  return Array.isArray(images) && images.some(image => {
    const url = (image as { url?: unknown } | null)?.url
    return typeof url === "string" && !!url.trim() &&
      !/(?:^|\/)images\/product-placeholder\.webp(?:[?#].*)?$/.test(url)
  })
}

export function catalogQuality(product: QualityProduct) {
  const profile = readProfile(product.metadata?.catalog_profile)
  const raw = product.metadata?.catalog_profile as Record<string, unknown> | undefined
  const noPhotos = !hasRealProductImage(product.images)
  const noPrice = !product.variants?.length || product.variants.some(v => !(v.prices ?? v.price_set?.prices)?.some(p => p.currency_code === "rub" && Number(p.amount) > 0))
  const missing = [
    ...(!product.title?.trim() ? ["Наименование"] : []), ...profileProblems(profile),
    ...(noPhotos ? ["Фото товара"] : []), ...(!product.categories?.length ? ["Категория"] : []),
    ...(!product.variants?.length ? ["Варианты, размеры и цены"] : noPrice ? ["Рублёвая цена вариантов"] : []),
    ...measurementProblems(raw?.measurements),
  ]
  return { missing, noPhotos, noPrice, noComposition: !profile.composition.trim(), noMeasurements: !Array.isArray(raw?.measurements) || !raw.measurements.length }
}
