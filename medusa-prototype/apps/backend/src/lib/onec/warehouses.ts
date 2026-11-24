export const ONEC_WAREHOUSE_TARGETS = [
  { key: "govorovo", name: "Говорово", postalCode: "108811", sourceId: "26b6c04c-4ac9-11f1-9646-e45be2b6c48c", sourceName: "Мосмарт" },
  { key: "prince-plaza", name: "Принц Плаза", postalCode: "117574", sourceId: "5b5f9977-a9c2-11f0-a596-101f742cfdb3", sourceName: "Принц плаза" },
  { key: "avenue", name: "Авеню", postalCode: "119571", sourceId: "72f2ca93-a9c6-11f0-a596-101f742cfdb3", sourceName: "Авеню" },
] as const

export function warehousePolicy(warehouses: { id: string; name: string }[]) {
  return {
    mergeCharacteristics: false,
    inventoryWritesEnabled: false,
    targets: ONEC_WAREHOUSE_TARGETS.map(target => ({
      ...target,
      matched: !!target.sourceId && warehouses.filter(warehouse => warehouse.id === target.sourceId && warehouse.name === target.sourceName).length === 1,
    })),
  }
}
