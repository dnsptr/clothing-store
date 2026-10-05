import type { MedusaContainer } from "@medusajs/framework"
import { ContainerRegistrationKeys, ProductStatus } from "@medusajs/framework/utils"
import {
  batchProductVariantsWorkflow,
  createProductCategoriesWorkflow,
  createProductsWorkflow,
  updateProductOptionsWorkflow,
  updateProductsWorkflow,
} from "@medusajs/medusa/core-flows"
import { CUSTOMER_CATALOG, CUSTOMER_CATALOG_SHARED, customerVariantSku, indexStableCustomerVariants, parseCustomerColors } from "./data/customer-catalog"

const IMPORT_SOURCE = "mario-mikke-customer-sheet"
const CATEGORY_DEFINITIONS = {
  knitwear: { name: "Трикотаж", handle: "knitwear" },
  skirts: { name: "Юбки", handle: "skirts" },
} as const

type ExecArgs = { container: MedusaContainer }

export default async function importCustomerCatalog({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const storefrontUrl = (process.env.STOREFRONT_URL || "http://localhost:3000").replace(/\/$/, "")
  if (process.env.NODE_ENV === "production" && storefrontUrl.includes("localhost")) throw new Error("Production STOREFRONT_URL is required")

  const [{ data: stores }, { data: salesChannels }, { data: shippingProfiles }, { data: existingCategories }] = await Promise.all([
    query.graph({ entity: "store", fields: ["id", "default_sales_channel_id"] }),
    query.graph({ entity: "sales_channel", fields: ["id", "name"] }),
    query.graph({ entity: "shipping_profile", fields: ["id", "name"] }),
    query.graph({ entity: "product_category", fields: ["id", "name", "handle"] }),
  ])
  const channelId = stores[0]?.default_sales_channel_id || salesChannels[0]?.id
  const shippingProfileId = shippingProfiles[0]?.id
  if (!channelId || !shippingProfileId) throw new Error("Sales channel or shipping profile is missing")

  const missingCategories = Object.values(CATEGORY_DEFINITIONS).filter(definition => !existingCategories.some(category => category.handle === definition.handle))
  if (missingCategories.length) await createProductCategoriesWorkflow(container).run({
    input: { product_categories: missingCategories.map(category => ({ ...category, is_active: true })) },
  })
  const { data: categories } = await query.graph({ entity: "product_category", fields: ["id", "handle"] })
  const categoryIds = new Map(categories.map(category => [category.handle, category.id]))
  const placeholderUrl = `${storefrontUrl}/images/product-placeholder.webp`

  const desired = CUSTOMER_CATALOG.map(row => {
    const colors = parseCustomerColors(row.colors)
    const categoryId = categoryIds.get(CATEGORY_DEFINITIONS[row.category].handle)
    if (!categoryId) throw new Error(`Category not found for ${row.article}`)
    const profile = {
      model: row.article,
      composition: row.composition ?? "",
      lining: "",
      no_lining: CUSTOMER_CATALOG_SHARED.noLining,
      country: CUSTOMER_CATALOG_SHARED.country,
      manufacturer: CUSTOMER_CATALOG_SHARED.manufacturer,
      manufacturer_address: row.manufacturerAddress,
      manufactured_at: "",
      care: CUSTOMER_CATALOG_SHARED.care,
      brand: CUSTOMER_CATALOG_SHARED.brand,
      conformity_document: row.conformityDocument ?? "",
      registry_url: "",
      measurements: [],
      label_images: [],
    }
    return {
      row,
      handle: `mario-mikke-${row.article.toLowerCase()}`,
      categoryId,
      colors,
      profile,
      options: [
        { title: "Размер", values: colors.length ? [CUSTOMER_CATALOG_SHARED.size] : [] },
        { title: "Цвет", values: colors },
      ],
      variants: colors.map((color, colorIndex) => ({
        title: `${CUSTOMER_CATALOG_SHARED.size} / ${color}`,
        sku: customerVariantSku(row.article, colorIndex),
        options: { "Размер": CUSTOMER_CATALOG_SHARED.size, "Цвет": color },
        prices: row.price ? [{ currency_code: "rub", amount: row.price }] : [],
        manage_inventory: true,
        allow_backorder: false,
      })),
    }
  })

  const { data: existingProducts } = await query.graph({
    entity: "product",
    fields: ["id", "handle", "status", "metadata", "images.url", "options.id", "options.title", "options.values.value", "variants.id", "variants.sku", "variants.title"],
    filters: { handle: desired.map(product => product.handle) },
  })
  const existingByHandle = new Map(existingProducts.map(product => [product.handle, product]))
  const create = desired.filter(product => !existingByHandle.has(product.handle))
  const update = desired.filter(product => existingByHandle.has(product.handle))
  const existingSkuIndices = new Map(update.map(product => {
    const existing = existingByHandle.get(product.handle)!
    return [product.handle, indexStableCustomerVariants(product.handle, product.variants, existing.variants ?? [])] as const
  }))

  if (create.length) await createProductsWorkflow(container).run({ input: { products: create.map(product => ({
    title: `${product.row.name} ${product.row.article}`,
    handle: product.handle,
    status: ProductStatus.DRAFT,
    thumbnail: placeholderUrl,
    images: [{ url: placeholderUrl }],
    category_ids: [product.categoryId],
    shipping_profile_id: shippingProfileId,
    sales_channels: [{ id: channelId }],
    metadata: { import_source: IMPORT_SOURCE, import_source_date: "2026-09-23", uses_placeholder_image: true, catalog_profile: product.profile },
    options: product.options,
    variants: product.variants,
  })) } })

  for (const product of update) {
    const existing = existingByHandle.get(product.handle)!
    const existingMetadata = (existing.metadata ?? {}) as Record<string, unknown>
    const existingProfile = (existingMetadata.catalog_profile ?? {}) as Record<string, unknown>
    const mergedProfile = { ...existingProfile }
    for (const [key, value] of Object.entries(product.profile)) {
      if ((typeof value === "string" && value.trim()) || value === true || (Array.isArray(value) && value.length)) mergedProfile[key] = value
    }
    const hasRealImage = (existing.images ?? []).some(image => image?.url && image.url !== placeholderUrl)
    await updateProductsWorkflow(container).run({ input: { products: [{
      id: existing.id,
      title: `${product.row.name} ${product.row.article}`,
      category_ids: [product.categoryId],
      shipping_profile_id: shippingProfileId,
      sales_channels: [{ id: channelId }],
      ...(!hasRealImage ? { thumbnail: placeholderUrl, images: [{ url: placeholderUrl }] } : {}),
      metadata: { ...existingMetadata, import_source: IMPORT_SOURCE, import_source_date: "2026-09-23", uses_placeholder_image: !hasRealImage, catalog_profile: mergedProfile },
    }] } })

    const options = existing.options ?? []
    let optionsReady = true
    for (const desiredOption of product.options) {
      const current = options.find(option => option?.title === desiredOption.title)
      if (!current) { optionsReady = false; logger.warn(`${product.handle}: option ${desiredOption.title} is missing`); continue }
      const values = (current.values ?? []).flatMap(value => value?.value ? [value.value] : [])
      const union = Array.from(new Set([...values, ...desiredOption.values]))
      if (union.length !== values.length) await updateProductOptionsWorkflow(container).run({ input: { selector: { id: current.id }, update: { values: union } } })
    }
    if (!optionsReady) continue

    const existingBySku = existingSkuIndices.get(product.handle)!
    const variantsToCreate = product.variants.filter(variant => !existingBySku.has(variant.sku)).map(variant => ({ ...variant, product_id: existing.id }))
    const variantsToUpdate = product.variants.filter(variant => existingBySku.has(variant.sku)).map(variant => ({
      id: existingBySku.get(variant.sku)!.id,
      title: variant.title,
      ...(product.row.price ? { prices: variant.prices } : {}),
    }))
    if (variantsToCreate.length || variantsToUpdate.length) await batchProductVariantsWorkflow(container).run({ input: { create: variantsToCreate, update: variantsToUpdate } })
  }

  logger.info(`Customer catalog import complete: ${create.length} created as drafts, ${update.length} updated, ${desired.reduce((sum, product) => sum + product.variants.length, 0)} desired variants. Inventory was not seeded.`)
}
