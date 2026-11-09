import { handoffRegistrySchema } from "../carrier-handoff";

const point = { id: "MSK-A", name: "Сдача A", address: "Москва, Тестовая, 1", active: true, city_code: 44 };

describe("handoff registry configuration boundaries", () => {
  it("rejects duplicate IDs and a default that cannot accept new dispatches", () => {
    expect(handoffRegistrySchema.safeParse({ cdek: { default_id: point.id, points: [point, { ...point, name: "Duplicate identity" }] } }).success).toBe(false);
    expect(handoffRegistrySchema.safeParse({ cdek: { default_id: point.id, points: [{ ...point, active: false }, { ...point, id: "MSK-B" }] } }).success).toBe(false);
    expect(handoffRegistrySchema.safeParse({ cdek: { default_id: null, points: [point] } }).success).toBe(false);
  });

  it("requires a real CDEK source city but does not require CDEK identifiers for Yandex", () => {
    const { city_code: _cityCode, ...station } = point;
    expect(handoffRegistrySchema.safeParse({ cdek: { default_id: station.id, points: [station] } }).success).toBe(false);
    expect(handoffRegistrySchema.parse({ yandex: { default_id: station.id, points: [station] } }).yandex?.points[0]).toEqual(station);
    expect(handoffRegistrySchema.parse({ cdek: { default_id: null, points: [{ ...point, active: false }] } }).cdek?.default_id).toBeNull();
  });
});
