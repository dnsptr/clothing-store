import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";

import { GET as getCities } from "../cities/route";
import { GET as getPvz } from "../pvz/route";
import { POST as calculateCdek } from "../calculate/route";
import { CdekApiError, CdekClient } from "../../../../modules/cdek/lib/cdek-client";

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

function request(input: { readonly query?: object; readonly body?: object; readonly ip: string }): MedusaRequest {
  return {
    query: input.query ?? {},
    body: input.body ?? {},
    ip: input.ip,
  } as unknown as MedusaRequest;
}

describe("CDEK public route security boundaries", () => {
  const originalEnvironment = process.env;

  beforeEach(() => {
    process.env = {
      ...originalEnvironment,
      CDEK_ENABLED: "true",
      CDEK_CLIENT_ID: "route-security-id",
      CDEK_CLIENT_SECRET: "route-security-secret",
      CDEK_API_BASE_URL: "https://api.edu.cdek.ru/v2",
      CDEK_FROM_CITY_CODE: "44",
    };
  });

  afterEach(() => {
    process.env = originalEnvironment;
    jest.restoreAllMocks();
  });

  it.each([
    ["one-character", "М"],
    ["too-long", "М".repeat(65)],
    ["unsupported-characters", "Москва<script>"],
  ])("returns 400 for a %s city query", async (_caseName, query) => {
    const search = jest.spyOn(CdekClient.prototype, "searchCities");
    const response = createResponse();

    await getCities(request({ query: { query }, ip: `198.51.100.${query.length}` }), response);

    expect(response.statusCode).toBe(400);
    expect(response.body).toEqual({ message: "Invalid request", cities: [] });
    expect(search).not.toHaveBeenCalled();
  });

  it("normalizes city whitespace before a bounded upstream search", async () => {
    const search = jest.spyOn(CdekClient.prototype, "searchCities").mockResolvedValue([]);
    const response = createResponse();

    await getCities(request({ query: { query: "  Санкт\t  Петербург  " }, ip: "198.51.100.20" }), response);

    expect(response.statusCode).toBe(200);
    expect(search).toHaveBeenCalledWith("Санкт Петербург", 15);
  });

  it("returns a generic 502 without exposing an upstream CDEK error", async () => {
    jest.spyOn(CdekClient.prototype, "searchCities").mockRejectedValue(
      new CdekApiError("https://api.edu.cdek.ru/v2 leaked secret raw-body", 500, { secret: true }),
    );
    const response = createResponse();

    await getCities(request({ query: { query: "Омск" }, ip: "198.51.100.21" }), response);

    expect(response.statusCode).toBe(502);
    expect(response.body).toEqual({ message: "Delivery provider unavailable", cities: [] });
    expect(JSON.stringify(response.body)).not.toContain("api.edu.cdek.ru");
  });

  it.each(["0", "-1", "1.5", "10000001", "44x"])(
    "returns 400 for invalid city code %s",
    async (cityCode) => {
      const points = jest.spyOn(CdekClient.prototype, "getDeliveryPoints");
      const response = createResponse();

      await getPvz(request({ query: { city_code: cityCode }, ip: `203.0.113.${cityCode.length}` }), response);

      expect(response.statusCode).toBe(400);
      expect(points).not.toHaveBeenCalled();
    },
  );

  it("caps PVZ results to the bounded requested limit", async () => {
    const points = jest.spyOn(CdekClient.prototype, "getDeliveryPoints").mockResolvedValue(
      Array.from({ length: 150 }, (_, index) => ({
        code: `PVZ-${index}`,
        name: `Point ${index}`,
        type: "PVZ" as const,
        location: { address: "Address", city_code: 44, city: "Москва" },
        work_time: "10-20",
      })),
    );
    const response = createResponse();

    await getPvz(request({ query: { city_code: "44", limit: "25" }, ip: "203.0.113.25" }), response);

    expect(points).toHaveBeenCalledWith(44);
    expect(response.body).toMatchObject({ pvz: expect.any(Array) });
    expect((response.body as { pvz: unknown[] }).pvz).toHaveLength(25);
  });

  it.each([
    ["unsupported tariff", { to_city_code: 44, tariff_code: 999 }],
    ["missing package", { to_city_code: 44 }],
    ["infinite weight", { to_city_code: 44, weight: Number.POSITIVE_INFINITY }],
    ["excessive weight", { to_city_code: 44, weight: 30_001 }],
    ["zero dimension", { to_city_code: 44, length: 0, width: 20, height: 10 }],
    ["excessive side", { to_city_code: 44, length: 121, width: 10, height: 10 }],
    ["excessive dimension sum", { to_city_code: 44, length: 60, width: 60, height: 31 }],
  ])("returns 400 for %s", async (_caseName, body) => {
    const calculate = jest.spyOn(CdekClient.prototype, "calculateTariff");
    const response = createResponse();

    await calculateCdek(request({ body, ip: `192.0.2.${Object.keys(body).length}` }), response);

    expect(response.statusCode).toBe(400);
    expect(response.body).toEqual({ message: "Invalid request" });
    expect(calculate).not.toHaveBeenCalled();
  });

  it("makes only the approved requested tariff call", async () => {
    const calculate = jest.spyOn(CdekClient.prototype, "calculateTariff").mockResolvedValue({
      tariff_code: 136,
      tariff_name: "PVZ",
      delivery_sum: 250,
      period_min: 1,
      period_max: 2,
    });
    const response = createResponse();

    await calculateCdek(request({
      body: { to_city_code: 44, tariff_code: 136, weight: 1200, length: 30, width: 20, height: 10 },
      ip: "192.0.2.136",
    }), response);

    expect(response.statusCode).toBe(200);
    expect(calculate).toHaveBeenCalledTimes(1);
    expect(calculate).toHaveBeenCalledWith({
      toCityCode: 44,
      tariffCode: 136,
      packages: [{ weight: 1200, length: 30, width: 20, height: 10 }],
    });
    expect(response.body).toEqual({
      pvz: expect.objectContaining({ tariff_code: 136 }),
      courier: null,
      customer_cost: 0,
    });
  });

  it("fails the whole calculation with a generic 502 when either requested tariff fails", async () => {
    jest.spyOn(CdekClient.prototype, "calculateTariff").mockRejectedValue(
      new CdekApiError("credential and raw response", 503, { credential: "secret" }),
    );
    const response = createResponse();

    await calculateCdek(request({ body: { to_city_code: 137, weight: 1200, length: 30, width: 20, height: 10 }, ip: "192.0.2.137" }), response);

    expect(response.statusCode).toBe(502);
    expect(response.body).toEqual({ message: "Delivery provider unavailable" });
  });
});
