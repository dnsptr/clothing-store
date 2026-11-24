export interface SiteInfoSection { title: string; paragraphs: string[]; items?: string[]; footnote?: string }
export interface SiteInfoPage { slug: string; title: string; summary: string; notice?: string; document?: { href: string; label: string }; sections: SiteInfoSection[] }
export interface SiteLink { label: string; href: string }
export interface SiteContent {
  footer: { columns: { title: string; links: SiteLink[] }[]; legalLinks: SiteLink[]; contactTitle: string; contactText: string; phone: string; phoneHref: string; email: string; copyright: string }
  pages: SiteInfoPage[]
}
export const REQUIRED_INFO_SLUGS = ["offer", "privacy", "consent", "delivery", "returns", "cookies", "requisites"] as const
export class SiteContentValidationError extends Error {}
const invalid = (path: string): never => { throw new SiteContentValidationError(`Проверьте поле: ${path}`) }
const object = (value: unknown, path: string): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : invalid(path)
const string = (value: unknown, path: string, max = 300, required = true): string => typeof value === "string" && value.length <= max && (!required || !!value.trim()) && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value) ? value : invalid(path)
const array = (value: unknown, path: string, max: number, min = 0): unknown[] => Array.isArray(value) && value.length >= min && value.length <= max ? value : invalid(path)
export function safeContentHref(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2000 || /[\s\\\u0000-\u001f\u007f]/.test(value) || /%(?:2f|5c|0a|0d|09)/i.test(value)) return false
  if (value.startsWith("/") && !value.startsWith("//")) return true
  try { const url = new URL(value); return !url.username && !url.password && (url.protocol === "https:" || (url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) } catch { return false }
}
const link = (value: unknown, path: string): SiteLink => { const row = object(value, path); if (!safeContentHref(row.href)) invalid(`${path}.href`); return { label: string(row.label, `${path}.label`), href: row.href as string } }
export function parseSiteContent(value: unknown): SiteContent {
  const root = object(value, "контент")
  if (JSON.stringify(root).length > 350_000) invalid("слишком большой объём текста")
  const footer = object(root.footer, "футер")
  const pages = array(root.pages, "страницы", 40, 7).map((value, index): SiteInfoPage => {
    const path = `страницы[${index + 1}]`, row = object(value, path)
    const slug = string(row.slug, `${path}.адрес`, 60)
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) invalid(`${path}.адрес`)
    let document: SiteInfoPage["document"]
    if (row.document) {
      document = link(row.document, `${path}.документ`)
      const pathname = new URL(document.href, "https://store.local").pathname
      if (!/\.(?:pdf|docx)$/i.test(pathname)) invalid(`${path}.документ: только PDF или DOCX`)
    }
    return { slug, title: string(row.title, `${path}.заголовок`), summary: string(row.summary, `${path}.описание`, 4000, false), ...(row.notice ? { notice: string(row.notice, `${path}.примечание`, 12000, false) } : {}), ...(document ? { document } : {}), sections: array(row.sections, `${path}.разделы`, 60, 1).map((section, i) => {
      const item = object(section, `${path}.раздел[${i + 1}]`)
      return { title: string(item.title, `${path}.раздел.заголовок`), paragraphs: array(item.paragraphs, `${path}.абзацы`, 150).map(text => string(text, `${path}.абзац`, 30000)), ...(item.items ? { items: array(item.items, `${path}.список`, 150).filter(text => text !== "").map(text => string(text, `${path}.пункт`, 12000)) } : {}), ...(item.footnote ? { footnote: string(item.footnote, `${path}.сноска`, 12000) } : {}) }
    }) }
  })
  const slugs = new Set(pages.map(page => page.slug))
  if (slugs.size !== pages.length || REQUIRED_INFO_SLUGS.some(slug => !slugs.has(slug))) invalid("обязательные страницы и уникальность адресов")
  const legalLinks = array(footer.legalLinks, "правовые ссылки", 20, 7).map((value, i) => link(value, `правовая ссылка ${i + 1}`))
  if (new Set(legalLinks.map(link => link.href)).size !== legalLinks.length) invalid("повторяющиеся правовые ссылки")
  if (REQUIRED_INFO_SLUGS.some(slug => !legalLinks.some(link => link.href === `/info/${slug}`))) invalid("ссылки на семь обязательных документов")
  const columns = array(footer.columns, "колонки футера", 4, 1).map((value, i) => { const row = object(value, `колонка ${i + 1}`); return { title: string(row.title, "заголовок колонки"), links: array(row.links, "ссылки колонки", 20, 1).map((value, j) => link(value, `ссылка ${i + 1}.${j + 1}`)) } })
  for (const entry of [...legalLinks, ...columns.flatMap(column => column.links)]) if (entry.href.startsWith("/info/") && !slugs.has(entry.href.slice(6))) invalid(`страница по ссылке ${entry.href} не существует`)
  const email = string(footer.email, "электронная почта", 254)
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) invalid("электронная почта")
  const phoneHref = string(footer.phoneHref, "телефон для звонка", 30)
  if (!/^\+?\d{5,20}$/.test(phoneHref)) invalid("телефон для звонка")
  return { footer: { columns, legalLinks, contactTitle: string(footer.contactTitle, "заголовок контактов"), contactText: string(footer.contactText, "текст контактов", 3000, false), phone: string(footer.phone, "телефон", 80), phoneHref, email, copyright: string(footer.copyright, "подпись", 200) }, pages }
}
