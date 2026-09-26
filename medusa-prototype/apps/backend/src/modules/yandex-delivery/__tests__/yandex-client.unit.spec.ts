import {
  YandexDeliveryClient,
  YandexDeliveryApiError,
} from "../lib/yandex-client";
import type { YandexDeliveryProviderOptions } from "../config";

const TEST_OPTIONS: YandexDeliveryProviderOptions = {
  token: "test_oauth_token",
  apiBaseUrl: "https://b2b-authproxy.taxi.yandex.net/api/b2b/platform",
  sourceStationId: "station_mario_mikke_moscow",
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
      destinationStationId: "station_dest_123",
      weightGrossGrams: 1500, dxCm: 30, dyCm: 20, dzCm: 15, assessedPriceRub: 5000,
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
      source: { platform_station_id: TEST_OPTIONS.sourceStationId },
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

    const result = await client.createPvzOrder({
      orderId: "ord_1001",
      destinationStationId: "station_dest_123",
      recipientFirstName: "Иван",
      recipientLastName: "Иванов",
      recipientPhone: "+79991234567",
      items: [{ title: "Кроссовки", article: "item_1", unitPrice: 5000, quantity: 1, dxCm: 30, dyCm: 20, dzCm: 15 }],
      weightGrossGrams: 1200, dxCm: 30, dyCm: 20, dzCm: 15, assessedPriceRub: 5000,
    });
    expect(result.offerId).toBe("offer_xyz_789");
    expect(result.requestId).toBe("req_order_456");
    const offerBody = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
    expect(offerBody).toMatchObject({
      recipient_info: { first_name: "Иван", last_name: "Иванов" },
      places: [{ physical_dims: { weight_gross: 1200, dx: 30, dy: 20, dz: 15 } }],
      items: [{ billing_details: { unit_price: 500000, assessed_unit_price: 500000 },
        physical_dims: { dx: 30, dy: 20, dz: 15 } }],
    });
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
