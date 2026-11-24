import { ONEC_WAREHOUSE_TARGETS, warehousePolicy } from "../warehouses"

it("keeps source characteristics distinct and never enables inventory writes", () => {
  const policy = warehousePolicy([])
  expect(policy.mergeCharacteristics).toBe(false)
  expect(policy.inventoryWritesEnabled).toBe(false)
  expect(policy.targets.every(target => !target.matched)).toBe(true)
  expect(policy.targets.find(target => target.key === "govorovo")?.sourceName).toBe("Мосмарт")
})
it("recognizes only explicitly selected source IDs with the expected names", () => {
  const definitions = ONEC_WAREHOUSE_TARGETS.filter(target => target.sourceId).map(target => ({ id: target.sourceId!, name: target.sourceName! }))
  const policy = warehousePolicy([...definitions, { id: "other", name: "Говорово" }])
  expect(policy.targets.filter(target => target.matched).map(target => target.key)).toEqual(["govorovo", "prince-plaza", "avenue"])
  expect(warehousePolicy([{ id: "other", name: "Авеню" }]).targets.every(target => !target.matched)).toBe(true)
  expect(warehousePolicy([...definitions, definitions[0]]).targets.find(target => target.key === "govorovo")?.matched).toBe(false)
})
it("uses the confirmed Mosmart ID for Govorovo, not a guessed name match", () => {
  const target = ONEC_WAREHOUSE_TARGETS.find(target => target.key === "govorovo")!
  expect(target.sourceId).toBe("26b6c04c-4ac9-11f1-9646-e45be2b6c48c")
  expect(warehousePolicy([{ id: target.sourceId, name: "Мосмарт" }]).targets.find(target => target.key === "govorovo")?.matched).toBe(true)
  expect(warehousePolicy([{ id: "other-id", name: "Мосмарт" }]).targets.every(target => !target.matched)).toBe(true)
})
