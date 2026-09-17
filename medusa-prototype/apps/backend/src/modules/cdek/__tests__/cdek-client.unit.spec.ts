import { CdekClient, CdekApiError } from "../lib/cdek-client";
import type { CdekProviderOptions } from "../config";

const TEST_OPTIONS: CdekProviderOptions = {
  clientId: "mock-client-id",
  clientSecret: "mock-client-secret",
  apiBaseUrl: "https://api.edu.cdek.ru/v2",
  fromCityCode: 44,
};

describe("CdekClient", () => {
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it("obtains and caches OAuth token", async () => {
    let tokenRequests = 0;
    global.fetch = jest.fn(async (url: RequestInfo | URL) => {
      const urlStr = String(url);
      if (urlStr.includes("/oauth/token")) {
        tokenRequests++;
        return {
          ok: true,
          status: 200,
          json: async () => ({ access_token: "mock-token-123", expires_in: 3600 }),
          text: async () => JSON.stringify({ access_token: "mock-token-123", expires_in: 3600 }),
        } as unknown as Response;
      }
      if (urlStr.includes("/location/cities")) {
        return {
          ok: true,
          status: 200,
          json: async () => [{ code: 44, city: "Москва" }],
          text: async () => JSON.stringify([{ code: 44, city: "Москва" }]),
        } as unknown as Response;
      }
      return { ok: false, status: 404, text: async () => "Not found" } as unknown as Response;
    });

    const client = new CdekClient(TEST_OPTIONS);

    // Call 1
    const cities1 = await client.searchCities("Моск");
    expect(cities1).toHaveLength(1);
    expect(cities1[0].city).toBe("Москва");
    expect(tokenRequests).toBe(1);

    // Call 2 should use cached token
    const cities2 = await client.searchCities("Моск");
    expect(cities2).toHaveLength(1);
    expect(tokenRequests).toBe(1);
  });

  it("retries request when token expires with 401", async () => {
    let callCount = 0;
    global.fetch = jest.fn(async (url: RequestInfo | URL) => {
      const urlStr = String(url);
      if (urlStr.includes("/oauth/token")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ access_token: "mock-token-refresh", expires_in: 3600 }),
          text: async () => JSON.stringify({ access_token: "mock-token-refresh", expires_in: 3600 }),
        } as unknown as Response;
      }
      if (urlStr.includes("/deliverypoints")) {
        callCount++;
        if (callCount === 1) {
          // First attempt fails with 401
          return {
            ok: false,
            status: 401,
            json: async () => ({ message: "Unauthorized" }),
            text: async () => JSON.stringify({ message: "Unauthorized" }),
          } as unknown as Response;
        }
        // Second attempt succeeds
        return {
          ok: true,
          status: 200,
          json: async () => [
            {
              code: "MSK1",
              name: "ПВЗ Тверская",
              location: { address: "ул. Тверская 1", city_code: 44, city: "Москва" },
              work_time: "10-20",
            },
          ],
          text: async () =>
            JSON.stringify([
              {
                code: "MSK1",
                name: "ПВЗ Тверская",
                location: { address: "ул. Тверская 1", city_code: 44, city: "Москва" },
                work_time: "10-20",
              },
            ]),
        } as unknown as Response;
      }
      return { ok: false, status: 404, text: async () => "" } as unknown as Response;
    });

    const client = new CdekClient(TEST_OPTIONS);
    const pvz = await client.getDeliveryPoints(44);
    expect(pvz).toHaveLength(1);
    expect(pvz[0].code).toBe("MSK1");
    expect(callCount).toBe(2);
  });

  it("calculates tariff successfully", async () => {
    global.fetch = jest.fn(async (url: RequestInfo | URL) => {
      const urlStr = String(url);
      if (urlStr.includes("/oauth/token")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ access_token: "mock-token", expires_in: 3600 }),
          text: async () => JSON.stringify({ access_token: "mock-token", expires_in: 3600 }),
        } as unknown as Response;
      }
      if (urlStr.includes("/calculator/tariff")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            delivery_sum: 250,
            period_min: 1,
            period_max: 3,
            delivery_date_range: { min: "2026-09-20", max: "2026-09-22" },
          }),
          text: async () =>
            JSON.stringify({
              delivery_sum: 250,
              period_min: 1,
              period_max: 3,
              delivery_date_range: { min: "2026-09-20", max: "2026-09-22" },
            }),
        } as unknown as Response;
      }
      return { ok: false, status: 404, text: async () => "" } as unknown as Response;
    });

    const client = new CdekClient(TEST_OPTIONS);
    const result = await client.calculateTariff({
      toCityCode: 137,
      tariffCode: 136,
    });

    expect(result.delivery_sum).toBe(250);
    expect(result.period_min).toBe(1);
    expect(result.period_max).toBe(3);
    expect(result.tariff_code).toBe(136);
  });

  it("throws CdekApiError on non-2xx response from CDEK API", async () => {
    global.fetch = jest.fn(async (url: RequestInfo | URL) => {
      const urlStr = String(url);
      if (urlStr.includes("/oauth/token")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ access_token: "mock-token", expires_in: 3600 }),
          text: async () => JSON.stringify({ access_token: "mock-token", expires_in: 3600 }),
        } as unknown as Response;
      }
      return {
        ok: false,
        status: 400,
        json: async () => ({ errors: [{ code: "v2_bad_request", message: "Invalid city code" }] }),
        text: async () =>
          JSON.stringify({ errors: [{ code: "v2_bad_request", message: "Invalid city code" }] }),
      } as unknown as Response;
    });

    const client = new CdekClient(TEST_OPTIONS);
    await expect(client.getDeliveryPoints(999999)).rejects.toThrow(CdekApiError);
  });
});
