import { addToCartWorkflow, completeCartWorkflow, createCartWorkflow } from "@medusajs/medusa/core-flows"
import { assertPurchasableVariants } from "../../lib/catalog-preview"

createCartWorkflow.hooks.validate(async ({ input }, { container }) => {
  await assertPurchasableVariants(container, (input.items ?? []).flatMap(item => item.variant_id ? [item.variant_id] : []))
})

addToCartWorkflow.hooks.validate(async ({ input }, { container }) => {
  await assertPurchasableVariants(container, input.items.flatMap(item => item.variant_id ? [item.variant_id] : []))
})

completeCartWorkflow.hooks.validate(async ({ cart }, { container }) => {
  await assertPurchasableVariants(container, (cart.items ?? []).flatMap((item: { variant_id?: string }) => item.variant_id ? [item.variant_id] : []))
})
