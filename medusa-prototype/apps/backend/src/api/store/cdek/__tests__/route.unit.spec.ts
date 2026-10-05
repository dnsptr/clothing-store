import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";

import { GET as getCities } from "../cities/route";
import { GET as getPvz } from "../pvz/route";
import { GET as getStores } from "../stores/route";
import { POST as calculateCdek } from "../calculate/route";
import { CdekClient } from "../../../../modules/cdek/lib/cdek-client";

function createMockResponse() {
  const res = {
    statusCode: 200,
    body: null as unknown,
    status: jest.fn().mockImplementation((code: number) => {
      res.statusCode = code;
      return res;
    }),
    json: jest.fn().mockImplementation((data: unknown) => {
      res.body = data;
      return res;
    }),
  };
  return res as unknown as MedusaResponse & { statusCode: number; body: unknown };
}

describe("CDEK Store API Routes", () => {
  const originalEnv = process.env;

  const setCdekEnabledEnv = () => {
    process.env.CDEK_ENABLED = "true";
    process.env.CDEK_CLIENT_ID = "test_id";
    process.env.CDEK_CLIENT_SECRET = "test_secret";
    process.env.CDEK_API_BASE_URL = "https://api.edu.cdek.ru/v2";
    process.env.CDEK_FROM_CITY_CODE = "44";
  };

  const setCdekDisabledEnv = () => {
    delete process.env.CDEK_ENABLED;
    delete process.env.CDEK_CLIENT_ID;
    delete process.env.CDEK_CLIENT_SECRET;
    delete process.env.CDEK_API_BASE_URL;
  };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.restoreAllMocks();
  });

  describe("GET /store/cdek/cities", () => {
    it("returns 400 when query is empty", async () => {
      const req = { query: {} } as unknown as MedusaRequest;
      const res = createMockResponse();

      await getCities(req, res);

      expect(res.statusCode).toBe(400);
      expect(res.body).toEqual({ message: "Invalid request", cities: [] });
    });

    it("returns 503 when CDEK is not configured", async () => {
      setCdekDisabledEnv();

      const req = { query: { query: "Москва" } } as unknown as MedusaRequest;
      const res = createMockResponse();

      await getCities(req, res);

      expect(res.statusCode).toBe(503);
      expect(res.body).toEqual({ message: "Delivery service unavailable", cities: [] });
    });

    it("returns searched cities on success", async () => {
      setCdekEnabledEnv();

      jest.spyOn(CdekClient.prototype, "searchCities").mockResolvedValue([
        { code: 44, city: "Москва", region: "Москва" },
      ]);

      const req = { query: { query: "Моск" } } as unknown as MedusaRequest;
      const res = createMockResponse();

      await getCities(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.body).toEqual({
        cities: [{ code: 44, city: "Москва", region: "Москва" }],
      });
    });

    it("returns a sanitized 502 when CdekClient throws", async () => {
      setCdekEnabledEnv();

      jest.spyOn(CdekClient.prototype, "searchCities").mockRejectedValue(new Error("Network timeout"));

      const req = { query: { query: "Москва" } } as unknown as MedusaRequest;
      const res = createMockResponse();

      await getCities(req, res);

      expect(res.statusCode).toBe(502);
      expect(res.body).toEqual({ message: "Delivery provider unavailable", cities: [] });
    });
  });

  describe("GET /store/cdek/pvz", () => {
    it("returns 400 for invalid city_code", async () => {
      const req = { query: { city_code: "invalid" } } as unknown as MedusaRequest;
      const res = createMockResponse();

      await getPvz(req, res);

      expect(res.statusCode).toBe(400);
      expect(res.body).toEqual({ message: "Invalid request", pvz: [] });
    });

    it("returns 400 for non-positive city_code", async () => {
      const req = { query: { city_code: "-5" } } as unknown as MedusaRequest;
      const res = createMockResponse();

      await getPvz(req, res);

      expect(res.statusCode).toBe(400);
    });

    it("returns 503 when CDEK is not configured", async () => {
      setCdekDisabledEnv();

      const req = { query: { city_code: "44" } } as unknown as MedusaRequest;
      const res = createMockResponse();

      await getPvz(req, res);

      expect(res.statusCode).toBe(503);
    });

    it("returns delivery points when city_code is valid", async () => {
      setCdekEnabledEnv();

      jest.spyOn(CdekClient.prototype, "getDeliveryPoints").mockResolvedValue([
        {
          code: "MSK1",
          name: "ПВЗ Тверская",
          type: "PVZ",
          location: { address: "Тверская, 1", city_code: 44, city: "Москва" },
          work_time: "10-20",
        },
      ]);

      const req = { query: { city_code: "44" } } as unknown as MedusaRequest;
      const res = createMockResponse();

      await getPvz(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.body).toMatchObject({
        pvz: [expect.objectContaining({ code: "MSK1", name: "ПВЗ Тверская" })],
      });
    });
  });

  describe("GET /store/cdek/stores", () => {
    it("returns Mario Mikke retail stores in Moscow", async () => {
      const req = {} as unknown as MedusaRequest;
      const res = createMockResponse();

      await getStores(req, res);

      expect(res.statusCode).toBe(200);
      const stores = (res.body as any).stores;
      expect(Array.isArray(stores)).toBe(true);
      expect(stores.length).toBe(3);
      expect(stores.map((s: any) => s.id)).toEqual(["store_vodny", "store_govorovo", "store_nebo"]);
      expect(stores.find((store: { id: string }) => store.id === "store_govorovo")?.address)
        .toBe("г. Москва, 47-й км МКАД, вл. 31, стр. 1");
    });
  });

  describe("POST /store/cdek/calculate", () => {
    it("returns 400 when to_city_code is missing or invalid", async () => {
      const req = { body: {} } as unknown as MedusaRequest;
      const res = createMockResponse();

      await calculateCdek(req, res);

      expect(res.statusCode).toBe(400);
      expect(res.body).toEqual({ message: "Invalid request" });
    });

    it("returns 503 when CDEK is not configured", async () => {
      setCdekDisabledEnv();

      const req = { body: { to_city_code: 44, weight: 1200, length: 30, width: 20, height: 10 } } as unknown as MedusaRequest;
      const res = createMockResponse();

      await calculateCdek(req, res);

      expect(res.statusCode).toBe(503);
    });

    it("calculates PVZ and courier tariffs with 0 customer_cost", async () => {
      setCdekEnabledEnv();

      jest.spyOn(CdekClient.prototype, "calculateTariff").mockImplementation(async ({ tariffCode }) => {
        if (tariffCode === 136) {
          return { tariff_code: 136, delivery_sum: 250, period_min: 1, period_max: 2, weight_calc: 1000, tariff_name: "Посылка склад-склад" };
        }
        return { tariff_code: 137, delivery_sum: 450, period_min: 1, period_max: 2, weight_calc: 1000, tariff_name: "Посылка склад-дверь" };
      });

      const req = { body: { to_city_code: 44, weight: 1200, length: 30, width: 20, height: 10 } } as unknown as MedusaRequest;
      const res = createMockResponse();

      await calculateCdek(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.body).toEqual({
        pvz: expect.objectContaining({ delivery_sum: 250 }),
        courier: expect.objectContaining({ delivery_sum: 450 }),
        customer_cost: 0,
      });
    });
  });
});
