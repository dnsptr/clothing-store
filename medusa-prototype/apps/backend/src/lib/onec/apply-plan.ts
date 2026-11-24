import type { planCatalogSync } from "./sync-plan"

export type CatalogSyncPlan = ReturnType<typeof planCatalogSync>
export type CatalogSyncOperations = {
  updateOption: (input: { productId: string; id: string; values: string[] }) => Promise<unknown>
  batchVariants: (input: Pick<CatalogSyncPlan["actions"][number], "create" | "update">) => Promise<unknown>
  updateProduct: (input: { id: string; metadata: Record<string, unknown> }) => Promise<unknown>
}

export async function applyCatalogPlan(plan: CatalogSyncPlan, operations: CatalogSyncOperations) {
  // Options are additive. Variant workflows compensate failures; persisted ID
  // bindings make a retry safe if the process stops between products.
  for (const action of plan.actions) {
    for (const option of action.optionUpdates) await operations.updateOption({ ...option, productId: action.productId })
    if (action.create.length || action.update.length) await operations.batchVariants({ create: action.create, update: action.update })
    if (action.updateMetadata) await operations.updateProduct({ id: action.productId, metadata: action.metadata })
  }
}
