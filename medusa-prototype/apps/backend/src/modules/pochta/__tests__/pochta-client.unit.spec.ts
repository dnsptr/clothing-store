import {
  PochtaClient,
  PochtaApiError,
} from "../lib/pochta-client";
import type { PochtaProviderOptions } from "../config";

const TEST_OPTIONS: PochtaProviderOptions = {
  accessToken: "test_token",
  userKey: "test_key",
  apiBaseUrl: "https://otpravka-api.pochta.ru/1.0",
  fromIndex: "119571",
};

describe("PochtaClient", () => {
  let client: PochtaClient;
  const originalFetch = global.fetch;

  beforeEach(() => {
    client = new PochtaClient(TEST_OPTIONS);
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("calculates tariff for parcel online using Pochta API", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      text: async () =>
        JSON.stringify({
          "total-rate": 35000, // 350 rubles in kopecks
          "total-vat": 7000,
          "delivery-time": {
            "min-days": 2,
            "max-days": 4,
          },
        }),
    });

    const result = await client.calculateTariff({
      toIndex: "190000",
      weightGrams: 1500,
      lengthCm: 30,
      widthCm: 20,
      heightCm: 10,
      isCourier: false,
    });

    expect(result.total_rate_rubles).toBe(350);
    expect(result.vat_rubles).toBe(70);
    expect(result.delivery_time_days_min).toBe(2);
    expect(result.delivery_time_days_max).toBe(4);
    expect(result.mail_type).toBe("ONLINE_PARCEL");

    expect(global.fetch).toHaveBeenCalledWith(
      "https://otpravka-api.pochta.ru/1.0/tariff",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "AccessToken test_token",
          "X-User-Authorization": "Basic test_key",
        }),
      }),
    );
  });

  it("calculates tariff for courier online", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      text: async () =>
        JSON.stringify({
          "total-rate": 59000,
          "total-vat": 11800,
          "delivery-time": {
            "min-days": 1,
            "max-days": 3,
          },
        }),
    });

    const result = await client.calculateTariff({
      toIndex: "190000",
      weightGrams: 1000,
      lengthCm: 30,
      widthCm: 20,
      heightCm: 10,
      isCourier: true,
    });

    expect(result.total_rate_rubles).toBe(590);
    expect(result.mail_type).toBe("ONLINE_COURIER");
  });

  it("propagates network failure instead of fabricating a tariff", async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error("Pochta connection timeout"));

    await expect(client.calculateTariff({
      toIndex: "630000",
      weightGrams: 1000,
      lengthCm: 30,
      widthCm: 20,
      heightCm: 10,
      isCourier: false,
    })).rejects.toThrow("Pochta connection timeout");
  });

  it("propagates post-office network failure", async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error("Network error"));

    await expect(client.getNearbyPostOffices("119571")).rejects.toThrow("Network error");
  });

  it.each([null, {}, []])("rejects empty or malformed post-office data", async (payload) => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(payload),
    });

    await expect(client.getNearbyPostOffices("119571")).rejects.toThrow(PochtaApiError);
  });

  it("rejects malformed successful tariff data", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ "total-rate": "35000" }),
    });

    await expect(client.calculateTariff({
      toIndex: "190000",
      weightGrams: 1000,
      lengthCm: 30,
      widthCm: 20,
      heightCm: 10,
    })).rejects.toThrow(PochtaApiError);
  });

  it("creates backlog order and returns barcode", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      text: async () =>
        JSON.stringify({
          result: {
            "result-ids": [{ barcode: "80088812345678", id: 101 }],
          },
        }),
    });

    const result = await client.createBacklogOrder({
      orderNumber: "ord_100",
      toIndex: "119571",
      recipientAddress: "Москва, Ленинский, 156",
      recipientName: "Петр Петров",
      recipientPhone: "+79260001122",
      weightGrams: 1000,
      lengthCm: 30,
      widthCm: 20,
      heightCm: 10,
    });

    expect(result.barcode).toBe("80088812345678");
    expect(result.orderId).toBe("101");
  });

  it("rejects a successful backlog response without a real barcode and order id", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ result: { "result-ids": [{}] } }),
    });

    await expect(client.createBacklogOrder({
      orderNumber: "ord_100",
      toIndex: "119571",
      recipientAddress: "Москва, Ленинский, 156",
      recipientName: "Петр Петров",
      recipientPhone: "+79260001122",
      weightGrams: 1000,
      lengthCm: 30,
      widthCm: 20,
      heightCm: 10,
    })).rejects.toThrow(PochtaApiError);
  });
});
