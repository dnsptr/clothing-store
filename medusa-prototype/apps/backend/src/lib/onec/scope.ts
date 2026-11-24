import type { parseCatalog, parseOffers } from "./preview"

// Only the assortment approved in the customer's spreadsheet, not all of 1C.
export const ONEC_CATALOG_ARTICLES = [
  "1351", "1603", "1647", "1760", "2015", "1857-1", "1453-1",
  "1994", "2018", "1812", "4262", "1856-1", "1730", "2014",
  "1999", "1917", "1592", "1897", "1916", "1301", "2016",
] as const

export function scopeCatalog(catalog: ReturnType<typeof parseCatalog>, offers: ReturnType<typeof parseOffers>) {
  const allowed = new Set<string>(ONEC_CATALOG_ARTICLES)
  const products = catalog.products.filter(product => allowed.has(product.article.trim()))
  const ids = new Set(products.map(product => product.id))
  const received = new Set(products.map(product => product.article.trim()))
  const selectedOffers = offers.offers.filter(offer => ids.has(offer.id.split("#")[0]))
  return {
    catalog: { ...catalog, products },
    offers: { ...offers, offers: selectedOffers },
    scope: {
      authority: "1c" as const,
      expectedArticles: [...ONEC_CATALOG_ARTICLES],
      receivedArticles: [...received],
      missingArticles: ONEC_CATALOG_ARTICLES.filter(article => !received.has(article)),
      excludedProducts: catalog.products.length - products.length,
      excludedOffers: offers.offers.length - selectedOffers.length,
    },
  }
}
