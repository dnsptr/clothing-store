import YandexDeliveryFulfillmentProviderService from "../service";
import { YANDEX_OPTION_PVZ } from "../provider-id";
import type { YandexDeliveryProviderOptions } from "../config";
import type { ValidateFulfillmentDataContext } from "@medusajs/types";
import { YandexFulfillmentDataError } from "../fulfillment-data";

const TEST_OPTIONS: YandexDeliveryProviderOptions = {
  token: "test_token",
  apiBaseUrl: "https://b2b-authproxy.taxi.yandex.net/api/b2b/platform",
  sourceStationId: "confirmed_source_station",
  pvzPriceRub: 450,
};

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
const ITEM = { id: "item_1", title: "Сапоги", quantity: 1, unit_price: 12000,
  variant: { weight: 500, length: 30, width: 20, height: 10 } };
const CONTEXT = { items: [ITEM] } as unknown as ValidateFulfillmentDataContext;
const ORDER = {
  id: "order_789", display_id: 100789, items: [ITEM],
  shipping_address: { first_name: "Анна", last_name: "Смирнова", phone: "+79998887766" },
};

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
      destinationStationId: STATION.id, weightGrossGrams: 500,
      dxCm: 30, dyCm: 20, dzCm: 10, assessedPriceRub: 12000,
    });
    expect(validated).toMatchObject({
      ...SELECTION, delivery_mode: YANDEX_OPTION_PVZ,
      carrier_quote_amount: 350.5, carrier_quote_currency: "RUB",
      weight_gross_grams: 500, assessed_price_rub: 12000,
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
      { items: [{ ...ITEM, variant: { ...ITEM.variant, weight: null } }] } as unknown as ValidateFulfillmentDataContext,
    )).rejects.toThrow(YandexFulfillmentDataError);
    expect(calculate).not.toHaveBeenCalled();
  });

  it.each([
    { name: "multiple quantities", items: [{ ...ITEM, quantity: 2 }] },
    { name: "multiple line items", items: [ITEM, { ...ITEM, id: "item_2" }] },
  ])("does not quote individually packed units as one unit-sized parcel ($name)", async ({ items }) => {
    const client = service.getYandexClient();
    jest.spyOn(client, "getPickupPoints").mockResolvedValue([STATION]);
    const calculate = jest.spyOn(client, "calculatePricing");
    await expect(service.validateFulfillmentData({ id: YANDEX_OPTION_PVZ }, SELECTION,
      { items } as unknown as ValidateFulfillmentDataContext,
    )).rejects.toThrow("combined parcel");
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
    )).resolves.toEqual({ calculated_amount: 450, is_calculated_price_tax_inclusive: true });
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
    )).resolves.toEqual({ calculated_amount: 450, is_calculated_price_tax_inclusive: true });
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
      data, [{ line_item_id: ITEM.id, quantity: 1 }], ORDER, { shipping_option_id: "so_yandex_123" },
    );
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      destinationStationId: STATION.id, weightGrossGrams: 500,
      recipientFirstName: "Анна", recipientLastName: "Смирнова",
      items: [expect.objectContaining({ unitPrice: 12000, dxCm: 30, quantity: 1 })],
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
      [{ line_item_id: ITEM.id, quantity: 1 }], ORDER, { shipping_option_id: "so_yandex_123" }))
      .rejects.toThrow(YandexFulfillmentDataError);
    await expect(service.createFulfillment(data,
      [{ line_item_id: ITEM.id, quantity: 1 }], { ...ORDER, items: [{ ...ITEM, variant: { ...ITEM.variant, weight: 300 } }] },
      { shipping_option_id: "so_yandex_123" })).rejects.toThrow(YandexFulfillmentDataError);
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
