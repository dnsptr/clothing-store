import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";

import { GET as getCities } from "../cities/route";
import { GET as getStores } from "../stores/route";
import { CdekClient } from "../../../../modules/cdek/lib/cdek-client";

type TestResponse = MedusaResponse & {
  statusCode: number;
  body: unknown;
};

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

function cityRequest(query: string, ip?: string): MedusaRequest {
  return { query: { query }, ip } as unknown as MedusaRequest;
}

function deferred<T>() {
  let resolvePromise: (value: T) => void = () => undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

describe("CDEK public request guard", () => {
  const originalEnvironment = process.env;

  beforeEach(() => {
    process.env = {
      ...originalEnvironment,
      CDEK_ENABLED: "true",
      CDEK_CLIENT_ID: "route-guard-id",
      CDEK_CLIENT_SECRET: "route-guard-secret",
      CDEK_API_BASE_URL: "https://api.edu.cdek.ru/v2",
      CDEK_FROM_CITY_CODE: "44",
    };
  });

  afterEach(() => {
    process.env = originalEnvironment;
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it("returns 429 after the per-client request budget is exhausted", async () => {
    jest.spyOn(CdekClient.prototype, "searchCities").mockResolvedValue([]);
    const clientIp = "198.51.100.100";

    for (let index = 0; index < 30; index += 1) {
      const response = createResponse();
      await getCities(cityRequest("Курск", clientIp), response);
      expect(response.statusCode).toBe(200);
    }
    const rejectedResponse = createResponse();

    await getCities(cityRequest("Курск", clientIp), rejectedResponse);

    expect(rejectedResponse.statusCode).toBe(429);
    expect(rejectedResponse.body).toEqual({ message: "Too many requests", cities: [] });
  });

  it("counts invalid requests against the same public route budget", async () => {
    jest.spyOn(CdekClient.prototype, "searchCities").mockResolvedValue([]);
    const clientIp = "198.51.100.102";

    for (let index = 0; index < 30; index += 1) {
      await getCities(cityRequest("<invalid>", clientIp), createResponse());
    }
    const rejectedResponse = createResponse();
    await getCities(cityRequest("Пермь", clientIp), rejectedResponse);

    expect(rejectedResponse.statusCode).toBe(429);
  });

  it("uses one conservative shared bucket when Express cannot identify a client", async () => {
    jest.spyOn(CdekClient.prototype, "searchCities").mockResolvedValue([]);

    for (let index = 0; index < 30; index += 1) {
      await getCities(cityRequest("Тула"), createResponse());
    }
    const rejectedResponse = createResponse();

    await getCities(cityRequest("Тула"), rejectedResponse);

    expect(rejectedResponse.statusCode).toBe(429);
  });

  it("rate limits the static stores route as part of the public CDEK surface", async () => {
    const clientIp = "198.51.100.101";
    for (let index = 0; index < 30; index += 1) {
      await getStores(cityRequest("unused", clientIp), createResponse());
    }
    const rejectedResponse = createResponse();

    await getStores(cityRequest("unused", clientIp), rejectedResponse);

    expect(rejectedResponse.statusCode).toBe(429);
    expect(rejectedResponse.body).toEqual({ message: "Too many requests", stores: [] });
  });

  it("coalesces concurrent identical upstream requests", async () => {
    const pending = deferred<Awaited<ReturnType<CdekClient["searchCities"]>>>();
    const search = jest.spyOn(CdekClient.prototype, "searchCities").mockReturnValue(pending.promise);
    const firstResponse = createResponse();
    const secondResponse = createResponse();

    const first = getCities(cityRequest("Вологда", "203.0.113.31"), firstResponse);
    const second = getCities(cityRequest("Вологда", "203.0.113.32"), secondResponse);
    await Promise.resolve();

    expect(search).toHaveBeenCalledTimes(1);
    pending.resolve([{ code: 1, city: "Вологда" }]);
    await Promise.all([first, second]);
    expect(firstResponse.body).toEqual(secondResponse.body);
  });

  it("reuses a successful cached result without another upstream call", async () => {
    const search = jest.spyOn(CdekClient.prototype, "searchCities").mockResolvedValue([
      { code: 2, city: "Кострома" },
    ]);

    await getCities(cityRequest("Кострома", "203.0.113.33"), createResponse());
    const cachedResponse = createResponse();
    await getCities(cityRequest("Кострома", "203.0.113.34"), cachedResponse);

    expect(search).toHaveBeenCalledTimes(1);
    expect(cachedResponse.body).toEqual({ cities: [{ code: 2, city: "Кострома" }] });
  });

  it("expires cached public results after the bounded TTL", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-09-21T00:00:00Z"));
    const search = jest.spyOn(CdekClient.prototype, "searchCities").mockResolvedValue([]);

    await getCities(cityRequest("Рязань", "203.0.113.35"), createResponse());
    jest.advanceTimersByTime(60_001);
    await getCities(cityRequest("Рязань", "203.0.113.36"), createResponse());

    expect(search).toHaveBeenCalledTimes(2);
  });

  it("evicts old public results instead of growing the cache without bound", async () => {
    const search = jest.spyOn(CdekClient.prototype, "searchCities").mockResolvedValue([]);

    for (let index = 0; index < 257; index += 1) {
      await getCities(cityRequest(`Город ${index}`, `bounded-cache-client-${index}`), createResponse());
    }
    await getCities(cityRequest("Город 0", "bounded-cache-client-repeat"), createResponse());

    expect(search).toHaveBeenCalledTimes(258);
  });

  it("rejects excess unique upstream work with 503 instead of building a queue", async () => {
    const pending = deferred<Awaited<ReturnType<CdekClient["searchCities"]>>>();
    const search = jest.spyOn(CdekClient.prototype, "searchCities").mockReturnValue(pending.promise);
    const responses = Array.from({ length: 5 }, () => createResponse());
    const requests = responses.map((response, index) =>
      getCities(cityRequest(`Конкурент ${index}`, `192.0.2.${200 + index}`), response));
    await Promise.resolve();
    await Promise.resolve();

    expect(search).toHaveBeenCalledTimes(4);
    await requests[4];
    expect(responses[4].statusCode).toBe(503);
    expect(responses[4].body).toEqual({ message: "Delivery service busy", cities: [] });

    pending.resolve([]);
    await Promise.all(requests);
  });
});
