import {
  YandexDeliveryClient,
  YandexDeliveryApiError,
} from "../lib/yandex-client";
import type { YandexDeliveryProviderOptions } from "../config";
import type { YandexOfferCreateParams, YandexPlace } from "../lib/yandex-client";

const PLACE: YandexPlace = {
  groupId: "a".repeat(64), unitIndex: 1, weightGrossGrams: 1200, dxCm: 30, dyCm: 20, dzCm: 15,
};
const OFFER: YandexOfferCreateParams = {
  sourceStationId: "station_mario_mikke_moscow",
  orderId: "ord_1001", destinationStationId: "station_dest_123", recipientFirstName: "Иван",
  recipientLastName: "Иванов", recipientPhone: "+79991234567", recipientEmail: "buyer@example.com",
  items: [{ title: "Кроссовки", article: "variant_1", unitPrice: 5000,
    groupId: PLACE.groupId, unitIndex: 1 }],
  places: [PLACE], assessedPriceRub: 5000,
};

const TEST_OPTIONS: YandexDeliveryProviderOptions = {
  token: "test_oauth_token",
  apiBaseUrl: "https://b2b-authproxy.taxi.yandex.net/api/b2b/platform",
  pvzPriceRub: 450,
};

describe("YandexDeliveryClient", () => {
  let client: YandexDeliveryClient;
  const originalFetch = global.fetch;

  beforeEach(() => {
    client = new YandexDeliveryClient(TEST_OPTIONS);
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("retrieves pickup points for a given geo_id", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      text: async () =>
        JSON.stringify({
          points: [
            {
              id: "pvz_1",
              name: "ПВЗ Яндекс Маркет",
              type: "pickup_point",
              operator_id: "market_l4g",
              position: { latitude: 55.75, longitude: 37.61 },
              address: {
                full_address: "Москва, Тверская, 7",
                locality: "Москва",
                street: "Тверская",
              },
              contact: { phone: "+79991112233" },
              pickup_services: { is_fitting_allowed: true },
            },
          ],
        }),
    });

    const points = await client.getPickupPoints({ geo_id: 213 });

    expect(points).toHaveLength(1);
    expect(points[0].id).toBe("pvz_1");
    expect(points[0].name).toBe("ПВЗ Яндекс Маркет");
    expect(points[0].isFittingAllowed).toBe(true);
    expect(points[0].position).toEqual({ latitude: 55.75, longitude: 37.61 });
    expect(points[0].address.full_address).toBe("Москва, Тверская, 7");
  });

  it("resolves city name to geo_id and retrieves pickup points when string is passed", async () => {
    global.fetch = jest.fn()
      .mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({ variants: [{ geo_id: 213, address: "Москва" }] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        text: async () =>
          JSON.stringify({
            points: [
              {
                id: "pvz_2",
                name: "ПВЗ на Арбате",
                operator_id: "market_l4g",
                type: "pickup_point",
                position: [37.59, 55.74],
                address: { full_address: "Москва, Арбат, 10" },
              },
            ],
          }),
      });

    const points = await client.getPickupPoints("Москва");

    expect(points).toHaveLength(1);
    expect(points[0].id).toBe("pvz_2");
    expect(points[0].position).toEqual({ latitude: 55.74, longitude: 37.59 });
  });

  it("calculates delivery pricing and eta days using pricing-calculator", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      text: async () =>
        JSON.stringify({
          pricing_total: "280.00 RUB",
          delivery_days: 2,
        }),
    });

    const result = await client.calculatePricing({
      sourceStationId: OFFER.sourceStationId,
      destinationStationId: "station_dest_123",
      places: [{ ...PLACE, weightGrossGrams: 1500 }], assessedPriceRub: 5000,
    });
    expect(result.priceRub).toBe(280);
    expect(result.deliveryDays).toBe(2);
    expect(result.currency).toBe("RUB");
    expect(global.fetch).toHaveBeenCalledWith(
      "https://b2b-authproxy.taxi.yandex.net/api/b2b/platform/pricing-calculator",
      expect.objectContaining({
        method: "POST",
      }),
    );
    const pricingBody = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
    expect(pricingBody).toMatchObject({
      total_weight: 1500, total_assessed_price: 500000,
      source: { platform_station_id: OFFER.sourceStationId },
      places: [{ physical_dims: { weight_gross: 1500, dx: 30, dy: 20, dz: 15 } }],
    });
  });

  it("creates and confirms a PVZ order in Yandex Platform API", async () => {
    global.fetch = jest.fn()
      .mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({ offers: [{ offer_id: "offer_xyz_789" }] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({ request_id: "req_order_456" }),
      });

    const result = await client.createPvzOrder(OFFER);
    expect(result.offerId).toBe("offer_xyz_789");
    expect(result.requestId).toBe("req_order_456");
    const offerBody = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
    expect(offerBody).toMatchObject({
      recipient_info: { first_name: "Иван", last_name: "Иванов", email: OFFER.recipientEmail },
      source: { platform_station: { platform_id: OFFER.sourceStationId } },
      billing_info: { payment_method: "already_paid", delivery_cost: 0 },
      places: [{ physical_dims: { weight_gross: 1200, dx: 30, dy: 20, dz: 15 } }],
      items: [{ count: 1, billing_details: { unit_price: 500000, assessed_unit_price: 500000 },
        physical_dims: { dx: 30, dy: 20, dz: 15 } }],
    });
    expect(offerBody.items[0].place_barcode).toBe(offerBody.places[0].barcode);
  });

  it("sends the same real two-plus-one places for estimate and offer, with one linked item per box", async () => {
    global.fetch = jest.fn().mockImplementation(async (url: string) => ({
      ok: true,
      text: async () => JSON.stringify(url.endsWith("/pricing-calculator")
        ? { pricing_total: "850.00 RUB" } : { offers: [{ offer_id: "multi_offer" }] }),
    }));
    const places = [PLACE, { ...PLACE, unitIndex: 2 },
      { ...PLACE, groupId: "b".repeat(64), weightGrossGrams: 501, dxCm: 31, dyCm: 18, dzCm: 9 }];
    const items = places.map((place) => ({
      title: "Обувь", article: place.groupId === PLACE.groupId ? "variant_1" : "variant_2",
      unitPrice: place.groupId === PLACE.groupId ? 5000 : 3000,
      groupId: place.groupId, unitIndex: place.unitIndex,
    }));
    const params = { ...OFFER, places, items, assessedPriceRub: 13000 };
    await client.calculatePricing(params);
    await client.createOffer(params);
    await client.createOffer({ ...params, places: [...places].reverse(), items: [...items].reverse() });
    type WirePlace = {
      barcode: string;
      physical_dims: { weight_gross: number; dx: number; dy: number; dz: number };
    };
    type WireItem = { count: number; place_barcode: string; article: string };
    type WireBody = { places: WirePlace[]; items: WireItem[]; total_weight?: number; total_assessed_price?: number };
    const bodies = (global.fetch as jest.Mock).mock.calls.map((call: unknown[]) =>
      JSON.parse(String((call[1] as RequestInit).body)) as WireBody);
    const [pricing, offer, reordered] = bodies;
    expect(pricing.total_weight).toBe(2901);
    expect(pricing.total_assessed_price).toBe(1300000);
    expect(pricing.places.map((place) => place.physical_dims))
      .toEqual(offer.places.map((place) => place.physical_dims));
    expect(offer.places).toHaveLength(3);
    expect(offer.items).toHaveLength(3);
    expect(offer.items.map((item) => item.count)).toEqual([1, 1, 1]);
    expect(offer.places.map((place) => place.physical_dims)).toEqual([
      { weight_gross: 1200, dx: 30, dy: 20, dz: 15 },
      { weight_gross: 1200, dx: 30, dy: 20, dz: 15 },
      { weight_gross: 501, dx: 31, dy: 18, dz: 9 },
    ]);
    expect(offer.items.map((item) => item.place_barcode).sort())
      .toEqual(offer.places.map((place) => place.barcode).sort());
    expect(offer.places.every((place, index) =>
      offer.places.findIndex((candidate) => candidate.barcode === place.barcode) === index)).toBe(true);
    expect(reordered.places.map((place) => place.barcode).sort())
      .toEqual(offer.places.map((place) => place.barcode).sort());
    expect(reordered.items.map((item) => item.place_barcode).sort())
      .toEqual(offer.items.map((item) => item.place_barcode).sort());
  });

  it("uses the explicit alternate source for both pricing and offer creation", async () => {
    global.fetch = jest.fn().mockImplementation(async (url: string) => ({
      ok: true,
      text: async () => JSON.stringify(url.endsWith("/pricing-calculator")
        ? { pricing_total: "850.00 RUB" } : { offers: [{ offer_id: "alternate_offer" }] }),
    }));
    const params = { ...OFFER, sourceStationId: "alternate_dispatch_station" };
    await client.calculatePricing(params);
    await client.createOffer(params);
    const [pricing, offer] = (global.fetch as jest.Mock).mock.calls.map((call: unknown[]) =>
      JSON.parse(String((call[1] as RequestInit).body)) as {
        source: { platform_station_id?: string; platform_station?: { platform_id: string } };
      });
    expect(pricing.source.platform_station_id).toBe(params.sourceStationId);
    expect(offer.source.platform_station?.platform_id).toBe(params.sourceStationId);
  });

  it.each(["", " ", " source "])("rejects an absent or malformed explicit source %j", async (sourceStationId) => {
    global.fetch = jest.fn();
    await expect(client.calculatePricing({ ...OFFER, sourceStationId })).rejects.toThrow(YandexDeliveryApiError);
    await expect(client.createOffer({ ...OFFER, sourceStationId })).rejects.toThrow(YandexDeliveryApiError);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it.each([
    { name: "empty places", places: [] },
    { name: "duplicate unit identity", places: [PLACE, PLACE] },
    { name: "101 places", places: Array.from({ length: 101 }, (_, index) => ({ ...PLACE, unitIndex: index + 1 })) },
    { name: "overweight place", places: [{ ...PLACE, weightGrossGrams: 30001 }] },
    { name: "fractional measured weight", places: [{ ...PLACE, weightGrossGrams: 1200.1 }] },
    { name: "too long side", places: [{ ...PLACE, dxCm: 151 }] },
    { name: "oversized sum", places: [{ ...PLACE, dxCm: 150, dyCm: 150, dzCm: 1 }] },
    { name: "overweight order", places: Array.from({ length: 7 }, (_, index) =>
      ({ ...PLACE, unitIndex: index + 1, weightGrossGrams: 30000 })) },
  ])("rejects $name before estimate or offer network requests", async ({ places }) => {
    global.fetch = jest.fn();
    await expect(client.calculatePricing({ ...OFFER, places })).rejects.toThrow(YandexDeliveryApiError);
    await expect(client.createOffer({ ...OFFER, places })).rejects.toThrow(YandexDeliveryApiError);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it.each([
    { name: "empty box", places: [PLACE, { ...PLACE, unitIndex: 2 }], items: OFFER.items },
    { name: "orphan item", places: [PLACE], items: [{ ...OFFER.items[0], unitIndex: 2 }] },
    { name: "duplicate item linkage", places: [PLACE, { ...PLACE, unitIndex: 2 }],
      items: [OFFER.items[0], OFFER.items[0]] },
    { name: "wrong assessed total", places: [PLACE], items: [{ ...OFFER.items[0], unitPrice: 1 }] },
  ])("rejects $name before creating a carrier offer", async ({ places, items }) => {
    global.fetch = jest.fn();
    await expect(client.createOffer({ ...OFFER, places, items })).rejects.toThrow(YandexDeliveryApiError);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("retrieves request tracking status", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      text: async () =>
        JSON.stringify({
          request_id: "req_order_456",
          state: { status: "CREATED" },
        }),
    });

    const info = await client.getRequestInfo("req_order_456");

    expect(info.requestId).toBe("req_order_456");
    expect(info.status).toBe("CREATED");
  });

  it("cancels an active delivery request", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ status: "SUCCESS", reason: "cancelled", description: "Отменено" }),
    });

    await expect(client.cancelRequest("req_order_456")).resolves.toBeUndefined();
    expect(global.fetch).toHaveBeenCalledWith(
      "https://b2b-authproxy.taxi.yandex.net/api/b2b/platform/request/cancel",
      expect.objectContaining({
        method: "POST",
      }),
    );
    const cancelBody = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
    expect(cancelBody).toEqual({ request_id: "req_order_456" });
  });

  it.each(["ERROR", "CREATED"] as const)("does not mark an unconfirmed cancellation %s as complete", async (status) => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ status, reason: "processing", description: "Not cancelled" }),
    });
    await expect(client.cancelRequest("req_order_456")).rejects.toThrow(YandexDeliveryApiError);
  });

  it("throws YandexDeliveryApiError when API returns HTTP 500", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => JSON.stringify({ code: "INTERNAL_ERROR", message: "Server error" }),
    });

    await expect(client.detectLocation("Москва")).rejects.toThrow(YandexDeliveryApiError);
  });

  it("throws YandexDeliveryApiError when response is not JSON", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => "<html>Service Temporarily Unavailable</html>",
    });

    await expect(client.detectLocation("Москва")).rejects.toThrow(
      "Yandex Delivery returned non-JSON response",
    );
  });
});
