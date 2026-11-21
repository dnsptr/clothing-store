import YandexDeliveryFulfillmentProviderService from "../service";
import { YANDEX_OPTION_PVZ } from "../provider-id";
import type { YandexDeliveryProviderOptions } from "../config";
import type { ValidateFulfillmentDataContext } from "@medusajs/types";
import { YandexFulfillmentDataError } from "../fulfillment-data";

const TEST_OPTIONS: YandexDeliveryProviderOptions = {
  token: "test_token",
  apiBaseUrl: "https://b2b-authproxy.taxi.yandex.net/api/b2b/platform",
  pvzPriceRub: 350,
};

const ORIGIN = {
  carrier: "yandex" as const, id: "confirmed_source_station", name: "Отгрузка Центр",
  address: "Москва, Складская, 1",
};
const ALTERNATE_ORIGIN = { ...ORIGIN, id: "alternate_source_station", name: "Отгрузка Север" };
function location(defaultId = ORIGIN.id, points = [ORIGIN, ALTERNATE_ORIGIN]) {
  return { id: "sloc_yandex", address: { metadata: { carrier_handoff: { yandex: {
    default_id: defaultId,
    points: points.map(({ carrier: _carrier, ...point }) => ({ ...point, active: true })),
  } } } } };
}

const STATION = {
  id: "station_dest_1",
  name: "ПВЗ Центр",
  type: "pickup_point" as const,
  operatorId: "market_l4g",
  position: { latitude: 55.75, longitude: 37.61 },
  address: { full_address: "Москва, Тверская, 7", city: "Москва", geo_id: 213 },
  isFittingAllowed: true,
  isPartialRefuseAllowed: false,
};
const SELECTION = {
  platform_station_id: STATION.id, pvz_name: STATION.name,
  pvz_address: STATION.address.full_address, city: STATION.address.city, geo_id: 213,
};
const ITEM = { id: "item_1", variant_id: "variant_boots", title: "Сапоги", quantity: 1, unit_price: 12000,
  variant: { weight: 500, length: 30, width: 20, height: 10 } };
const CONTEXT = { items: [ITEM], from_location: location() } as unknown as ValidateFulfillmentDataContext;
const ORDER = {
  id: "order_789", display_id: 100789, items: [ITEM],
  email: "buyer@example.com",
  shipping_address: { first_name: "Анна", last_name: "Смирнова", phone: "+79998887766" },
};

function measuredContext(items: unknown[]): ValidateFulfillmentDataContext {
  // Keep the server-owned native source location alongside measured items.
  const context = { items, from_location: location() } as unknown as ValidateFulfillmentDataContext;
  return context;
}

describe("YandexDeliveryFulfillmentProviderService", () => {
  let service: YandexDeliveryFulfillmentProviderService;

  beforeEach(() => {
    service = new YandexDeliveryFulfillmentProviderService({}, TEST_OPTIONS);
  });
  afterEach(() => jest.restoreAllMocks());

  it("advertises the supported PVZ fulfillment option", async () => {
    const options = await service.getFulfillmentOptions();
    const ids = options.map((o) => o.id);
    expect(ids).toContain(YANDEX_OPTION_PVZ);
    expect(ids).toHaveLength(1);
    expect(options[0].name).toContain("Яндекс Маркет");
  });

  it("validates known fulfillment options", async () => {
    expect(await service.validateOption({ id: YANDEX_OPTION_PVZ })).toBe(true);
    expect(await service.validateOption({ id: "yandex-express" })).toBe(false);
    expect(await service.validateOption({ id: "unknown_yandex_option" })).toBe(false);
  });

  it("validates a real city-bound PVZ and persists a quote for the measured cart", async () => {
    const client = service.getYandexClient();
    jest.spyOn(client, "getPickupPoints").mockResolvedValue([STATION]);
    const calculate = jest.spyOn(client, "calculatePricing").mockResolvedValue({
      priceRub: 350.5, deliveryDays: 2, currency: "RUB",
    });
    const validated = await service.validateFulfillmentData({ id: YANDEX_OPTION_PVZ }, SELECTION, CONTEXT);
    expect(client.getPickupPoints).toHaveBeenCalledWith({ geo_id: 213 });
    expect(calculate).toHaveBeenCalledWith({
      sourceStationId: ORIGIN.id,
      destinationStationId: STATION.id, assessedPriceRub: 12000,
      places: [{ groupId: expect.any(String), unitIndex: 1, weightGrossGrams: 500,
        dxCm: 30, dyCm: 20, dzCm: 10 }],
    });
    expect(validated).toMatchObject({
      ...SELECTION, delivery_mode: YANDEX_OPTION_PVZ,
      handoff_origin: ORIGIN,
      carrier_quote_amount: 350.5, carrier_quote_currency: "RUB",
      package_manifest: [{ variantId: ITEM.variant_id, quantity: 1, unitPriceRub: 12000,
        measurements: ITEM.variant }],
    });
  });

  it("rejects missing station, wrong city/name, or station absent upstream before quote", async () => {
    const client = service.getYandexClient();
    jest.spyOn(client, "getPickupPoints").mockImplementation(async (criteria) =>
      typeof criteria !== "string" && criteria.geo_id === 213 ? [STATION] : []);
    const calculate = jest.spyOn(client, "calculatePricing");
    for (const invalid of [
      { ...SELECTION, platform_station_id: "" },
      { ...SELECTION, platform_station_id: "forged" },
      { ...SELECTION, city: "Казань" },
      { ...SELECTION, geo_id: 999 },
      { ...SELECTION, pvz_name: "Фальшивый ПВЗ" },
    ]) {
      await expect(service.validateFulfillmentData({ id: YANDEX_OPTION_PVZ }, invalid, CONTEXT))
        .rejects.toThrow(YandexFulfillmentDataError);
    }
    expect(calculate).not.toHaveBeenCalled();
  });

  it("rejects a cart without measured dimensions before pricing", async () => {
    const client = service.getYandexClient();
    jest.spyOn(client, "getPickupPoints").mockResolvedValue([STATION]);
    const calculate = jest.spyOn(client, "calculatePricing");
    await expect(service.validateFulfillmentData({ id: YANDEX_OPTION_PVZ }, SELECTION,
      { items: [{ ...ITEM, variant: { ...ITEM.variant, weight: null } }], from_location: location() } as unknown as ValidateFulfillmentDataContext,
    )).rejects.toThrow(YandexFulfillmentDataError);
    expect(calculate).not.toHaveBeenCalled();
  });

  it("quotes two plus one measured units and charges the fixed fee once", async () => {
    const client = service.getYandexClient();
    jest.spyOn(client, "getPickupPoints").mockResolvedValue([STATION]);
    const calculate = jest.spyOn(client, "calculatePricing").mockResolvedValue({
      priceRub: 980.5, currency: "RUB",
    });
    const items = [{ ...ITEM, quantity: 2 }, { ...ITEM, id: "item_2", variant_id: "variant_shoes",
      unit_price: 5000, variant: { weight: 1200, length: 35, width: 25, height: 15 } }];
    const context = measuredContext(items);
    const data = await service.validateFulfillmentData({ id: YANDEX_OPTION_PVZ }, SELECTION, context);
    const quoted = calculate.mock.calls[0][0];
    expect(quoted.assessedPriceRub).toBe(29000);
    expect(quoted.places).toHaveLength(3);
    expect(quoted.places.filter((place) => place.weightGrossGrams === 500))
      .toEqual([1, 2].map((unitIndex) => ({
        groupId: expect.any(String), unitIndex, weightGrossGrams: 500, dxCm: 30, dyCm: 20, dzCm: 10,
      })));
    expect(quoted.places.find((place) => place.weightGrossGrams === 1200))
      .toMatchObject({ unitIndex: 1, dxCm: 35, dyCm: 25, dzCm: 15 });
    expect(data).toMatchObject({ carrier_quote_amount: 980.5, carrier_quote_currency: "RUB" });
    await expect(service.calculatePrice({ id: YANDEX_OPTION_PVZ }, data, { items, from_location: location() }))
      .resolves.toEqual({ calculated_amount: 350, is_calculated_price_tax_inclusive: true });
  });

  it.each([
    { name: "duplicate line IDs", items: [ITEM, ITEM] },
    { name: "too many units", items: [{ ...ITEM, quantity: 100 }, { ...ITEM, id: "extra" }] },
    { name: "missing variant identity", items: [{ ...ITEM, variant_id: undefined }] },
    { name: "excessive package weight", items: [{ ...ITEM, variant: { ...ITEM.variant, weight: 30001 } }] },
  ])("rejects $name before any carrier call", async ({ items }) => {
    const client = service.getYandexClient();
    const points = jest.spyOn(client, "getPickupPoints");
    const calculate = jest.spyOn(client, "calculatePricing");
    const context = measuredContext(items);
    await expect(service.validateFulfillmentData({ id: YANDEX_OPTION_PVZ }, SELECTION, context))
      .rejects.toThrow(YandexFulfillmentDataError);
    await expect(service.calculatePrice({ id: YANDEX_OPTION_PVZ }, SELECTION, { items, from_location: location() }))
      .rejects.toThrow(YandexFulfillmentDataError);
    expect(points).not.toHaveBeenCalled();
    expect(calculate).not.toHaveBeenCalled();
  });

  it("charges the fixed buyer price instead of carrier expenses and refuses unavailable pricing", async () => {
    const client = service.getYandexClient();
    jest.spyOn(client, "getPickupPoints").mockResolvedValue([STATION]);
    jest.spyOn(client, "calculatePricing")
      .mockResolvedValueOnce({ priceRub: 350.5, deliveryDays: 2, currency: "RUB" })
      .mockRejectedValueOnce(new Error("carrier pricing unavailable"));

    await expect(service.calculatePrice(
      { id: YANDEX_OPTION_PVZ }, SELECTION, CONTEXT as unknown as Record<string, unknown>,
    )).resolves.toEqual({ calculated_amount: 350, is_calculated_price_tax_inclusive: true });
    await expect(service.calculatePrice(
      { id: YANDEX_OPTION_PVZ }, SELECTION, CONTEXT as unknown as Record<string, unknown>,
    )).rejects.toThrow("carrier pricing unavailable");
  });

  it("accepts a listed PVZ whose geo ID identifies a district within the selected city", async () => {
    const client = service.getYandexClient();
    jest.spyOn(client, "getPickupPoints").mockResolvedValue([{
      ...STATION, address: { ...STATION.address, geo_id: 120679 },
    }]);
    jest.spyOn(client, "calculatePricing").mockResolvedValue({ priceRub: 214.11, currency: "RUB" });

    await expect(service.calculatePrice(
      { id: YANDEX_OPTION_PVZ }, SELECTION, CONTEXT as unknown as Record<string, unknown>,
    )).resolves.toEqual({ calculated_amount: 350, is_calculated_price_tax_inclusive: true });
  });

  it("creates fulfillment with a Medusa so_ ID only after PVZ, quote and order items are verified", async () => {
    const client = service.getYandexClient();
    jest.spyOn(client, "getPickupPoints").mockResolvedValue([STATION]);
    jest.spyOn(client, "calculatePricing").mockResolvedValue({
      priceRub: 350, deliveryDays: 2, currency: "RUB",
    });
    const create = jest.spyOn(client, "createPvzOrder").mockResolvedValue({
      offerId: "off_123", requestId: "req_456",
    });
    const data = await service.validateFulfillmentData({ id: YANDEX_OPTION_PVZ }, SELECTION, CONTEXT);
    const result = await service.createFulfillment(
      data, [{ line_item_id: ITEM.id, quantity: 1 }], ORDER, { shipping_option_id: "so_yandex_123", location_id: location().id },
      { handoff_location: location() },
    );
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      sourceStationId: ORIGIN.id,
      destinationStationId: STATION.id,
      places: [expect.objectContaining({ weightGrossGrams: 500, dxCm: 30 })],
      recipientFirstName: "Анна", recipientLastName: "Смирнова",
      recipientEmail: ORDER.email,
      items: [expect.objectContaining({ unitPrice: 12000, article: ITEM.variant_id, unitIndex: 1 })],
    }));
    expect(result.data).toMatchObject({
      delivery_mode: YANDEX_OPTION_PVZ, platform_station_id: STATION.id,
      yandex_request_id: "req_456", yandex_offer_id: "off_123", carrier_quote_amount: 350,
    });
  });

  it("does not create an offer if station or measured order data changes after checkout", async () => {
    const client = service.getYandexClient();
    jest.spyOn(client, "getPickupPoints").mockResolvedValue([STATION]);
    jest.spyOn(client, "calculatePricing").mockResolvedValue({ priceRub: 350, currency: "RUB" });
    const create = jest.spyOn(client, "createPvzOrder");
    const data = await service.validateFulfillmentData({ id: YANDEX_OPTION_PVZ }, SELECTION, CONTEXT);
    await expect(service.createFulfillment({ ...data, platform_station_id: "forged" },
      [{ line_item_id: ITEM.id, quantity: 1 }], ORDER, { shipping_option_id: "so_yandex_123", location_id: location().id },
      { handoff_location: location() }))
      .rejects.toThrow(YandexFulfillmentDataError);
    await expect(service.createFulfillment(data,
      [{ line_item_id: ITEM.id, quantity: 1 }], { ...ORDER, items: [{ ...ITEM, variant: { ...ITEM.variant, weight: 300 } }] },
      { shipping_option_id: "so_yandex_123", location_id: location().id }, { handoff_location: location() }))
      .rejects.toThrow(YandexFulfillmentDataError);
    expect(create).not.toHaveBeenCalled();
  });

  it("fulfills reordered native order rows with the same three places and retains carrier expenses separately", async () => {
    const client = service.getYandexClient();
    jest.spyOn(client, "getPickupPoints").mockResolvedValue([STATION]);
    const calculate = jest.spyOn(client, "calculatePricing")
      .mockResolvedValueOnce({ priceRub: 980.5, currency: "RUB" })
      .mockResolvedValueOnce({ priceRub: 990.5, currency: "RUB" });
    const create = jest.spyOn(client, "createPvzOrder")
      .mockResolvedValue({ offerId: "multi_offer", requestId: "multi_request" });
    const items = [{ ...ITEM, quantity: 2 },
      { ...ITEM, id: "cart_2", variant_id: "variant_shoes", unit_price: 5000,
        variant: { weight: 1200, length: 35, width: 25, height: 15 } }];
    const data = await service.validateFulfillmentData({ id: YANDEX_OPTION_PVZ }, SELECTION, measuredContext(items));
    const nativeItems = [{ ...items[1], id: "ordli_2" }, { ...items[0], id: "ordli_1" }];
    const result = await service.createFulfillment(data, [
      { line_item_id: "ordli_1", quantity: 2 }, { line_item_id: "ordli_2", quantity: 1 },
    ], { ...ORDER, items: nativeItems }, { location_id: location().id }, { handoff_location: location() });
    const estimate = calculate.mock.calls[0][0];
    const fulfillmentQuote = calculate.mock.calls[1][0];
    expect(estimate.places).toHaveLength(3);
    expect(fulfillmentQuote.places).toEqual(estimate.places);
    expect(create.mock.calls[0][0].places).toEqual(estimate.places);
    expect(create.mock.calls[0][0].items).toHaveLength(3);
    expect(result.data).toMatchObject({
      package_manifest: data.package_manifest, carrier_quote_amount: 990.5,
      carrier_quote_currency: "RUB", yandex_request_id: "multi_request",
    });
  });

  it("rejects partial or same-sized swapped clothing units before any fulfillment carrier request", async () => {
    const client = service.getYandexClient();
    const points = jest.spyOn(client, "getPickupPoints").mockResolvedValue([STATION]);
    const calculate = jest.spyOn(client, "calculatePricing").mockResolvedValue({ priceRub: 350, currency: "RUB" });
    const create = jest.spyOn(client, "createPvzOrder");
    const data = await service.validateFulfillmentData({ id: YANDEX_OPTION_PVZ }, SELECTION,
      measuredContext([{ ...ITEM, quantity: 2 }]));
    points.mockClear();
    calculate.mockClear();
    await expect(service.createFulfillment(data, [{ line_item_id: ITEM.id, quantity: 1 }],
      { ...ORDER, items: [{ ...ITEM, quantity: 2 }] }, { location_id: location().id },
      { handoff_location: location() })).rejects.toThrow(YandexFulfillmentDataError);
    await expect(service.createFulfillment(data, [{ line_item_id: ITEM.id, quantity: 2 }],
      { ...ORDER, items: [{ ...ITEM, quantity: 2, variant_id: "swapped_variant" }] }, { location_id: location().id },
      { handoff_location: location() }))
      .rejects.toThrow(YandexFulfillmentDataError);
    expect(points).not.toHaveBeenCalled();
    expect(calculate).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it("ignores customer origin and registry fields during native checkout validation", async () => {
    const client = service.getYandexClient();
    jest.spyOn(client, "getPickupPoints").mockResolvedValue([STATION]);
    const calculate = jest.spyOn(client, "calculatePricing").mockResolvedValue({ priceRub: 800, currency: "RUB" });
    const data = await service.validateFulfillmentData({ id: YANDEX_OPTION_PVZ }, {
      ...SELECTION, handoff_origin: { ...ALTERNATE_ORIGIN, address: "Поддельный адрес" },
      carrier_handoff: { yandex: { default_id: "forged", points: [] } },
    }, CONTEXT);
    expect(data.handoff_origin).toEqual(ORIGIN);
    expect(data).not.toHaveProperty("carrier_handoff");
    expect(calculate).toHaveBeenCalledWith(expect.objectContaining({ sourceStationId: ORIGIN.id }));
  });

  it("retains the checkout source for pricing and booking after editing the default, and snapshots created data", async () => {
    const client = service.getYandexClient();
    jest.spyOn(client, "getPickupPoints").mockResolvedValue([STATION]);
    const calculate = jest.spyOn(client, "calculatePricing")
      .mockResolvedValue({ priceRub: 900.5, currency: "RUB" });
    const create = jest.spyOn(client, "createPvzOrder")
      .mockResolvedValue({ offerId: "saved_offer", requestId: "saved_request" });
    const data = await service.validateFulfillmentData({ id: YANDEX_OPTION_PVZ }, SELECTION, CONTEXT);
    const freshLocation = location(ALTERNATE_ORIGIN.id);
    await expect(service.calculatePrice({ id: YANDEX_OPTION_PVZ }, data, {
      items: [ITEM], from_location: freshLocation,
    })).resolves.toEqual({ calculated_amount: 350, is_calculated_price_tax_inclusive: true });
    const result = await service.createFulfillment(data, [{ line_item_id: ITEM.id, quantity: 1 }],
      ORDER, { location_id: freshLocation.id }, { handoff_location: freshLocation });
    expect(calculate.mock.calls.every(([params]) => params.sourceStationId === ORIGIN.id)).toBe(true);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ sourceStationId: ORIGIN.id }));
    expect(result.data.handoff_origin).toEqual(ORIGIN);
    freshLocation.address.metadata.carrier_handoff.yandex.points[0].name = "Изменено после создания";
    freshLocation.address.metadata.carrier_handoff.yandex.points[0].active = false;
    expect(data.handoff_origin).toEqual(ORIGIN);
    expect(result.data.handoff_origin).toEqual(ORIGIN);
  });

  it("accepts an allowed staff override, requotes it and books exactly the same source", async () => {
    const client = service.getYandexClient();
    jest.spyOn(client, "getPickupPoints").mockResolvedValue([STATION]);
    const calculate = jest.spyOn(client, "calculatePricing")
      .mockResolvedValueOnce({ priceRub: 800, currency: "RUB" })
      .mockResolvedValueOnce({ priceRub: 1800.75, currency: "RUB" });
    const create = jest.spyOn(client, "createPvzOrder")
      .mockResolvedValue({ offerId: "alternate_offer", requestId: "alternate_request" });
    const data = await service.validateFulfillmentData({ id: YANDEX_OPTION_PVZ }, SELECTION, CONTEXT);
    const result = await service.createFulfillment(data, [{ line_item_id: ITEM.id, quantity: 1 }],
      ORDER, { location_id: location().id }, { handoff_location: location(), dispatch_point_id: ALTERNATE_ORIGIN.id });
    const quoteParams = calculate.mock.calls[1][0];
    expect(quoteParams.sourceStationId).toBe(ALTERNATE_ORIGIN.id);
    expect(create).toHaveBeenCalledWith(quoteParams);
    expect(result.data).toMatchObject({
      handoff_origin: ALTERNATE_ORIGIN, carrier_quote_amount: 1800.75, carrier_quote_currency: "RUB",
      yandex_request_id: "alternate_request",
    });
    expect(data.handoff_origin).toEqual(ORIGIN);
  });

  it.each(["disabled", "deleted", "missing saved", "forged saved", "unknown override", "disabled override"])(
    "rejects %s source before any fulfillment carrier request", async (state) => {
      const client = service.getYandexClient();
      const points = jest.spyOn(client, "getPickupPoints").mockResolvedValue([STATION]);
      const calculate = jest.spyOn(client, "calculatePricing").mockResolvedValue({ priceRub: 800, currency: "RUB" });
      const create = jest.spyOn(client, "createPvzOrder");
      const data = await service.validateFulfillmentData({ id: YANDEX_OPTION_PVZ }, SELECTION, CONTEXT);
      let freshLocation = location(ALTERNATE_ORIGIN.id);
      if (state === "disabled" || state === "disabled override") {
        freshLocation.address.metadata.carrier_handoff.yandex.points[0].active = false;
      }
      if (state === "deleted") freshLocation = location(ALTERNATE_ORIGIN.id, [ALTERNATE_ORIGIN]);
      if (state === "missing saved") delete data.handoff_origin;
      if (state === "forged saved") data.handoff_origin = { carrier: "cdek", id: ORIGIN.id };
      points.mockClear();
      calculate.mockClear();
      const additionalData = {
        handoff_location: freshLocation,
        ...(state === "unknown override" ? { dispatch_point_id: "not_allowed" }
          : state === "disabled override" ? { dispatch_point_id: ORIGIN.id } : {}),
      };
      await expect(service.createFulfillment(data, [{ line_item_id: ITEM.id, quantity: 1 }],
        ORDER, { location_id: freshLocation.id }, additionalData)).rejects.toThrow();
      expect(points).not.toHaveBeenCalled();
      expect(calculate).not.toHaveBeenCalled();
      expect(create).not.toHaveBeenCalled();
    },
  );

  it.each(["missing context", "mismatched context", "missing location id"])(
    "rejects %s without falling back to an embedded location or saved source", async (state) => {
      const client = service.getYandexClient();
      const points = jest.spyOn(client, "getPickupPoints").mockResolvedValue([STATION]);
      const calculate = jest.spyOn(client, "calculatePricing").mockResolvedValue({ priceRub: 800, currency: "RUB" });
      const create = jest.spyOn(client, "createPvzOrder");
      const data = await service.validateFulfillmentData({ id: YANDEX_OPTION_PVZ }, SELECTION, CONTEXT);
      points.mockClear();
      calculate.mockClear();
      const fulfillment = state === "missing location id"
        ? { location: location() }
        : { location_id: location().id, location: location() };
      const additionalData = state === "missing context" ? {}
        : { handoff_location: { ...location(), id: state === "mismatched context" ? "sloc_other" : location().id } };

      await expect(service.createFulfillment(data, [{ line_item_id: ITEM.id, quantity: 1 }],
        ORDER, fulfillment, additionalData)).rejects.toThrow();
      expect(points).not.toHaveBeenCalled();
      expect(calculate).not.toHaveBeenCalled();
      expect(create).not.toHaveBeenCalled();
    },
  );

  it("never books an operator-configured source whose actual lane quote fails", async () => {
    const client = service.getYandexClient();
    jest.spyOn(client, "getPickupPoints").mockResolvedValue([STATION]);
    jest.spyOn(client, "calculatePricing")
      .mockResolvedValueOnce({ priceRub: 800, currency: "RUB" })
      .mockRejectedValueOnce(new Error("source cannot dispatch to this destination"));
    const create = jest.spyOn(client, "createPvzOrder");
    const data = await service.validateFulfillmentData({ id: YANDEX_OPTION_PVZ }, SELECTION, CONTEXT);
    await expect(service.createFulfillment(data, [{ line_item_id: ITEM.id, quantity: 1 }],
      ORDER, { location_id: location().id }, { handoff_location: location(), dispatch_point_id: ALTERNATE_ORIGIN.id }))
      .rejects.toThrow("source cannot dispatch to this destination");
    expect(create).not.toHaveBeenCalled();
  });

  it("cancels fulfillment order via Platform API", async () => {
    const client = service.getYandexClient();
    jest.spyOn(client, "cancelRequest").mockResolvedValue();

    await service.cancelFulfillment({
      data: { yandex_request_id: "req_456" },
    });

    expect(client.cancelRequest).toHaveBeenCalledWith("req_456");
  });
});
