import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";

import { POST as calculateYandex } from "../calculate/route";
import { GET as getYandexPvz } from "../pvz/route";
import { YandexDeliveryClient } from "../../../../modules/yandex-delivery/lib/yandex-client";
import { _resetPublicYandexForTesting } from "../../../../modules/yandex-delivery/public-api";

type TestResponse = MedusaResponse & { statusCode: number; body: unknown };

function createResponse(): TestResponse {
  const response = {
    statusCode: 200,
    body: null as unknown,
    status: jest.fn().mockImplementation((code: number) => {
      response.statusCode = code;
      return response;
    }),
    json: jest.fn().mockImplementation((body: unknown) => {
      response.body = body;
      return response;
    }),
  };
  return response as unknown as TestResponse;
}

const MEASURED_ITEMS = [
  { id: "item_1", quantity: 1, unit_price: 3500, variant: { weight: 1100, length: 25, width: 20, height: 15 } },
];

function request(input: { query?: object; body?: object; ip?: string; items?: unknown[] }): MedusaRequest {
  return {
    query: input.query ?? {},
    body: input.body ?? {},
    ip: input.ip ?? "198.51.100.10",
    scope: {
      resolve: () => ({
        graph: async () => ({ data: [{ id: "cart_measured", items: input.items ?? MEASURED_ITEMS }] }),
      }),
    },
  } as unknown as MedusaRequest;
}

const VALID_CALCULATION = {
  cart_id: "cart_measured",
  platform_station_id: "station_dest_123",
  geo_id: 213,
};

function mockConfirmedPoint() {
  return jest.spyOn(YandexDeliveryClient.prototype, "getPickupPoints").mockResolvedValue([{
    id: "station_dest_123",
    name: "ПВЗ Маркет",
    type: "pickup_point",
    operatorId: "market_l4g",
    address: { full_address: "Москва, Мира, 1", city: "Москва", geo_id: 213 },
    position: { latitude: 55.7, longitude: 37.6 },
    isFittingAllowed: false,
    isPartialRefuseAllowed: false,
  }]);
}

describe("Yandex Delivery public routes", () => {
  const originalEnvironment = process.env;

  beforeEach(() => {
    process.env = {
      ...originalEnvironment,
      YANDEX_DELIVERY_ENABLED: "true",
      YANDEX_DELIVERY_TOKEN: "test-token",
      YANDEX_DELIVERY_API_BASE_URL: "https://b2b-authproxy.taxi.yandex.net/api/b2b/platform",
      YANDEX_DELIVERY_SOURCE_STATION_ID: "station_source_1",
    };
    _resetPublicYandexForTesting();
  });

  afterEach(() => {
    process.env = originalEnvironment;
    jest.restoreAllMocks();
  });

  it.each([
    ["empty query", {}],
    ["too short city", { city: "М" }],
    ["unsupported city characters", { city: "Москва<script>" }],
  ])("returns 400 for %s", async (_name, query) => {
    const lookup = jest.spyOn(YandexDeliveryClient.prototype, "getPickupPoints");
    const response = createResponse();
    await getYandexPvz(request({ query }), response);
    expect(response.statusCode).toBe(400);
    expect(response.body).toEqual({ message: "Invalid request", points: [] });
    expect(lookup).not.toHaveBeenCalled();
  });

  it("returns 503 with no points when the provider is disabled", async () => {
    process.env.YANDEX_DELIVERY_ENABLED = "false";
    const response = createResponse();
    await getYandexPvz(request({ query: { city: "Москва" } }), response);
    expect(response.statusCode).toBe(503);
    expect(response.body).toEqual({ message: "Delivery service unavailable", points: [] });
  });

  it("returns generic 502 without exposing upstream pickup errors", async () => {
    jest.spyOn(YandexDeliveryClient.prototype, "getPickupPoints").mockRejectedValue(
      new Error("secret token and raw Yandex response"),
    );
    const response = createResponse();
    await getYandexPvz(request({ query: { city: "Москва" } }), response);
    expect(response.statusCode).toBe(502);
    expect(response.body).toEqual({ message: "Delivery provider unavailable", points: [] });
    expect(JSON.stringify(response.body)).not.toContain("secret token");
  });


  it("returns 400 for invalid calculation request without station id", async () => {
    const calculate = jest.spyOn(YandexDeliveryClient.prototype, "calculatePricing");
    const response = createResponse();
    await calculateYandex(request({ body: {} }), response);
    expect(response.statusCode).toBe(400);
    expect(response.body).toEqual({ message: "Invalid request" });
    expect(calculate).not.toHaveBeenCalled();
  });

  it("returns 503 instead of a fabricated estimate when disabled", async () => {
    process.env.YANDEX_DELIVERY_ENABLED = "false";
    const response = createResponse();
    await calculateYandex(request({ body: VALID_CALCULATION }), response);
    expect(response.statusCode).toBe(503);
    expect(response.body).toEqual({ message: "Delivery service unavailable" });
  });

  it("rejects a station outside the selected city before pricing", async () => {
    mockConfirmedPoint();
    const calculate = jest.spyOn(YandexDeliveryClient.prototype, "calculatePricing");
    const response = createResponse();
    await calculateYandex(request({ body: { ...VALID_CALCULATION, geo_id: 43 } }), response);
    expect(response.statusCode).toBe(400);
    expect(response.body).toEqual({ message: "Invalid pickup point" });
    expect(calculate).not.toHaveBeenCalled();
  });

  it("rejects an unmeasured cart instead of calculating a default parcel", async () => {
    mockConfirmedPoint();
    const calculate = jest.spyOn(YandexDeliveryClient.prototype, "calculatePricing");
    const response = createResponse();
    await calculateYandex(request({
      body: VALID_CALCULATION,
      items: [{ id: "item_1", quantity: 1, unit_price: 3500 }],
    }), response);
    expect(response.statusCode).toBe(400);
    expect(response.body).toEqual({ message: "Invalid cart measurements" });
    expect(calculate).not.toHaveBeenCalled();
  });

  it("prices measured cart items for a confirmed point while charging the shopper nothing", async () => {
    mockConfirmedPoint();
    const calculate = jest.spyOn(YandexDeliveryClient.prototype, "calculatePricing").mockResolvedValue({
      priceRub: 310,
      deliveryDays: 3,
      currency: "RUB",
    });
    const response = createResponse();
    await calculateYandex(request({ body: VALID_CALCULATION }), response);
    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({
      price: 310,
      delivery_days: 3,
      currency: "RUB",
      customer_cost: 0,
    });
    expect(calculate).toHaveBeenCalledWith({
      destinationStationId: "station_dest_123",
      weightGrossGrams: 1100,
      dxCm: 25,
      dyCm: 20,
      dzCm: 15,
      assessedPriceRub: 3500,
    });
  });

  it("rate limits repeated requests before upstream work", async () => {
    mockConfirmedPoint();
    const calculate = jest.spyOn(YandexDeliveryClient.prototype, "calculatePricing").mockResolvedValue({
      priceRub: 310,
      deliveryDays: 3,
      currency: "RUB",
    });
    for (let index = 0; index < 30; index += 1) {
      await calculateYandex(request({ body: VALID_CALCULATION, ip: "203.0.113.30" }), createResponse());
    }
    const response = createResponse();
    await calculateYandex(request({ body: VALID_CALCULATION, ip: "203.0.113.30" }), response);
    expect(response.statusCode).toBe(429);
    expect(response.body).toEqual({ message: "Too many requests" });
    expect(calculate).toHaveBeenCalledTimes(1);
  });
});
