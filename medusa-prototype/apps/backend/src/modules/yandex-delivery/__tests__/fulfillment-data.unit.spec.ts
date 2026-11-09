import { buildCartPackages, buildOfferParams, buildPricingParams, YandexFulfillmentDataError } from "../fulfillment-data";
import { YANDEX_OPTION_PVZ } from "../provider-id";

const BOOTS = {
  id: "cart_boots", variant_id: "variant_boots", title: "Сапоги", quantity: 2, unit_price: 12000,
  variant: { weight: 500.2, length: 30.1, width: 20, height: 10 },
};
const SHOES = {
  id: "cart_shoes", variant_id: "variant_shoes", title: "Туфли", quantity: 1, unit_price: 5000,
  variant: { weight: 1200, length: 35, width: 25, height: 15 },
};
const SELECTION = {
  delivery_mode: YANDEX_OPTION_PVZ, platform_station_id: "station_dest", pvz_name: "ПВЗ",
  pvz_address: "Москва, Мира, 1", city: "Москва", geo_id: 213,
};
function paidData(items: unknown[]) {
  return { ...SELECTION, package_manifest: buildCartPackages(items).manifest,
    carrier_quote_amount: 900.5, carrier_quote_currency: "RUB" };
}
function order(items: unknown[]) {
  return { id: "order_1", display_id: 101, email: "buyer@example.com", items,
    shipping_address: { first_name: "Анна", phone: "+79991234567" } };
}

describe("Yandex measured package manifest", () => {
  it("expands two plus one units with their own rounded physical measurements and real assessed total", () => {
    const result = buildCartPackages([BOOTS, SHOES]);
    expect(result.places).toHaveLength(3);
    const boots = result.places.filter((place) => place.weightGrossGrams === 501);
    expect(boots).toEqual([1, 2].map((unitIndex) => ({
      groupId: expect.any(String), unitIndex, weightGrossGrams: 501, dxCm: 31, dyCm: 20, dzCm: 10,
    })));
    expect(result.places.find((place) => place.weightGrossGrams === 1200))
      .toMatchObject({ unitIndex: 1, dxCm: 35, dyCm: 25, dzCm: 15 });
    expect(result.assessedPriceRub).toBe(29000);
    expect(buildPricingParams("station_dest", [SHOES, BOOTS], "station_source").places).toEqual(result.places);
    expect(result.manifest.find((group) => group.variantId === BOOTS.variant_id)?.measurements)
      .toEqual(BOOTS.variant);
  });

  it("keeps package identities stable across native line IDs, iteration order, splitting and merging equivalent units", () => {
    const data = paidData([BOOTS, SHOES]);
    const boots1 = { ...BOOTS, id: "order_boots_1", quantity: 1 };
    const boots2 = { ...BOOTS, id: "order_boots_2", quantity: 1 };
    const shoes = { ...SHOES, id: "order_shoes" };
    const params = buildOfferParams({ ...data, package_manifest: [...data.package_manifest].reverse() }, [
      { line_item_id: boots2.id, quantity: 1 }, { line_item_id: shoes.id, quantity: 1 },
      { line_item_id: boots1.id, quantity: 1 },
    ], order([shoes, boots1, boots2]), "station_source");
    expect(params.places).toEqual(buildPricingParams("station_dest", [BOOTS, SHOES], "station_source").places);
    expect(params.items).toHaveLength(3);
    expect(params.items.filter((item) => item.article === BOOTS.variant_id)).toHaveLength(2);
    expect(params.recipientEmail).toBe("buyer@example.com");
    const merged = buildOfferParams(paidData([boots1, boots2, shoes]), [
      { line_item_id: BOOTS.id, quantity: 2 }, { line_item_id: SHOES.id, quantity: 1 },
    ], order([BOOTS, SHOES]), "station_source");
    expect(merged.places).toEqual(params.places);
  });

  it.each([
    { name: "same-sized replacement variant", changed: { ...SHOES, variant_id: "variant_swapped" } },
    { name: "changed price", changed: { ...SHOES, unit_price: 4999 } },
    { name: "changed raw weight with unchanged rounded weight",
      changed: { ...SHOES, variant: { ...SHOES.variant, weight: 1199.9 } } },
    { name: "changed raw length with unchanged rounded length",
      changed: { ...SHOES, variant: { ...SHOES.variant, length: 34.9 } } },
    { name: "changed unit count", changed: { ...SHOES, quantity: 2 } },
  ])("rejects $name rather than silently diverging from the paid manifest", ({ changed }) => {
    expect(() => buildOfferParams(paidData([BOOTS, SHOES]), [
      { line_item_id: BOOTS.id, quantity: 2 }, { line_item_id: changed.id, quantity: changed.quantity },
    ], order([BOOTS, changed]), "station_source")).toThrow(YandexFulfillmentDataError);
  });

  it.each([
    { name: "partial line", items: [{ line_item_id: BOOTS.id, quantity: 1 }, { line_item_id: SHOES.id, quantity: 1 }] },
    { name: "missing line", items: [{ line_item_id: BOOTS.id, quantity: 2 }] },
    { name: "duplicate line IDs", items: [{ line_item_id: BOOTS.id, quantity: 2 }, { line_item_id: BOOTS.id, quantity: 2 }] },
    { name: "unknown line", items: [{ line_item_id: BOOTS.id, quantity: 2 }, { line_item_id: "missing", quantity: 1 }] },
  ])("rejects $name in native fulfillment input", ({ items }) => {
    expect(() => buildOfferParams(paidData([BOOTS, SHOES]), items, order([BOOTS, SHOES]), "station_source"))
      .toThrow(YandexFulfillmentDataError);
  });

  it("rejects duplicate order IDs and absent or altered manifests", () => {
    const data = paidData([BOOTS]);
    const items = [{ line_item_id: BOOTS.id, quantity: 2 }];
    expect(() => buildOfferParams(data, items, order([BOOTS, BOOTS]), "station_source")).toThrow(YandexFulfillmentDataError);
    for (const package_manifest of [undefined, [], [...data.package_manifest, ...data.package_manifest],
      data.package_manifest.map((group) => ({ ...group, groupId: "0".repeat(64) }))]) {
      expect(() => buildOfferParams({ ...data, package_manifest }, items, order([BOOTS]), "station_source"))
        .toThrow(YandexFulfillmentDataError);
    }
  });

  it("requires the separately retained verified RUB carrier price", () => {
    for (const quote of [{ carrier_quote_amount: undefined }, { carrier_quote_amount: -1 },
      { carrier_quote_currency: "USD" }]) {
      expect(() => buildOfferParams({ ...paidData([BOOTS]), ...quote },
        [{ line_item_id: BOOTS.id, quantity: 2 }], order([BOOTS]), "station_source")).toThrow(YandexFulfillmentDataError);
    }
  });

  it("supports the existing 100-place cap across quantities, not just lines", () => {
    expect(buildCartPackages([{ ...BOOTS, quantity: 99 }, SHOES]).places).toHaveLength(100);
    expect(() => buildCartPackages([{ ...BOOTS, quantity: 100 }, SHOES])).toThrow(YandexFulfillmentDataError);
  });

  it("honors standard Market PVZ per-place dimensions and order weight boundaries", () => {
    const large = { ...BOOTS, quantity: 6,
      variant: { weight: 30000, length: 150, width: 100, height: 50 } };
    const final = { ...SHOES, variant: { weight: 20000, length: 150, width: 100, height: 50 } };
    expect(buildCartPackages([large, final]).places).toHaveLength(7);
    expect(() => buildCartPackages([large, { ...final, variant: { ...final.variant, weight: 20001 } }]))
      .toThrow(YandexFulfillmentDataError);
    for (const variant of [
      { ...large.variant, weight: 30000.1 }, { ...large.variant, length: 150.1 },
      { ...large.variant, height: 50.1 },
    ]) {
      expect(() => buildCartPackages([{ ...large, quantity: 1, variant }])).toThrow(YandexFulfillmentDataError);
    }
  });

  it.each([undefined, null, 0, -1, Infinity, NaN, "500"])("rejects invalid measured package weight %s", (weight) => {
    expect(() => buildCartPackages([{ ...BOOTS, variant: { ...BOOTS.variant, weight } }]))
      .toThrow(YandexFulfillmentDataError);
  });

  it("uses real product measurements and variant.id when returned by the graph", () => {
    const { variant_id: _variantId, variant: _variant, ...item } = BOOTS;
    expect(buildCartPackages([{ ...item, variant: { id: BOOTS.variant_id, product: BOOTS.variant } }]).places)
      .toEqual(buildCartPackages([BOOTS]).places);
    expect(() => buildCartPackages([{ ...BOOTS, variant: { ...BOOTS.variant, id: "variant_conflict" } }]))
      .toThrow(YandexFulfillmentDataError);
    expect(() => buildCartPackages([BOOTS, BOOTS])).toThrow(YandexFulfillmentDataError);
  });
});
