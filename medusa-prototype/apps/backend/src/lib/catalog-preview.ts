import type { MedusaContainer } from "@medusajs/framework"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"

export async function assertPurchasableVariants(container: MedusaContainer, variantIds: string[]) {
  const ids = [...new Set(variantIds.filter(Boolean))]
  if (!ids.length) return
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "product_variant",
    fields: ["id", "product.metadata", "product.status"],
    filters: { id: ids },
  })
  if (data.some(variant => variant.product?.metadata?.storefront_preview === true)) {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "Товар доступен только для просмотра и пока не продаётся.")
  }
  if (data.some(variant => variant.product?.status && variant.product.status !== "published")) {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "Товар снят с публикации и недоступен для заказа.")
  }
}
