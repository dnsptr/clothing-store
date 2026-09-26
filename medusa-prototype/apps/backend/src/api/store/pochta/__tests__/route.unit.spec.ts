import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";

import { GET as getPochtaPostOffices, _resetClientForTesting as resetPostofficesClient } from "../postoffices/route";
import { POST as calculatePochta, _resetClientForTesting as resetCalculateClient } from "../calculate/route";
import {
  PochtaClient,
} from "../../../../modules/pochta/lib/pochta-client";
import { _resetPublicPochtaForTesting } from "../../../../modules/pochta/public-api";

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

function deferred<T>() {
  let resolvePromise: (value: T) => void = () => undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

describe("Russian Post (Pochta) Store API Routes", () => {
  const originalEnv = process.env;

  const setPochtaEnabledEnv = () => {
    process.env.POCHTA_ENABLED = "true";
    process.env.POCHTA_ACCESS_TOKEN = "test_tok";
    process.env.POCHTA_USER_KEY = "test_key";
    process.env.POCHTA_API_BASE_URL = "https://otpravka-api.pochta.ru/1.0";
    process.env.POCHTA_FROM_INDEX = "119571";
  };

  const setPochtaDisabledEnv = () => {
    delete process.env.POCHTA_ENABLED;
    delete process.env.POCHTA_ACCESS_TOKEN;
    delete process.env.POCHTA_USER_KEY;
    delete process.env.POCHTA_API_BASE_URL;
  };

  beforeEach(() => {
    process.env = { ...originalEnv };
    resetPostofficesClient();
    resetCalculateClient();
    _resetPublicPochtaForTesting();
  });

  afterEach(() => {
    process.env = originalEnv;
    resetPostofficesClient();
    resetCalculateClient();
    _resetPublicPochtaForTesting();
    jest.restoreAllMocks();
  });

  describe("GET /store/pochta/postoffices", () => {
    it("returns 503 when module is not configured", async () => {
      setPochtaDisabledEnv();

      const req = { query: { postal_code: "101000" } } as unknown as MedusaRequest;
      const res = createMockResponse();

      await getPochtaPostOffices(req, res);

      expect(res.statusCode).toBe(503);
      expect(res.body).toEqual({ message: "Delivery service unavailable", offices: [] });
    });

    it("returns post offices from client when configured", async () => {
      setPochtaEnabledEnv();

      const mockOffices = [
        {
          postal_code: "101000",
          address_source: "г. Москва, ул. Мясницкая, д. 26",
          latitude: 55.76,
          longitude: 37.63,
          work_time: "Круглосуточно",
        },
      ];

      jest.spyOn(PochtaClient.prototype, "getNearbyPostOffices").mockResolvedValue(mockOffices);

      const req = { query: { postal_code: "101000" } } as unknown as MedusaRequest;
      const res = createMockResponse();

      await getPochtaPostOffices(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.body).toEqual({ offices: mockOffices });
    });

    it("returns a generic 502 on client error", async () => {
      setPochtaEnabledEnv();

      jest.spyOn(PochtaClient.prototype, "getNearbyPostOffices").mockRejectedValue(new Error("secret raw upstream data"));

      const req = { query: { postal_code: "101000" } } as unknown as MedusaRequest;
      const res = createMockResponse();

      await getPochtaPostOffices(req, res);

      expect(res.statusCode).toBe(502);
      expect(res.body).toEqual({ message: "Delivery provider unavailable", offices: [] });
      expect(JSON.stringify(res.body)).not.toContain("secret");
    });

    it("rejects a non-six-digit postal index without calling Pochta", async () => {
      setPochtaEnabledEnv();
      const lookup = jest.spyOn(PochtaClient.prototype, "getNearbyPostOffices");
      const res = createMockResponse();
      await getPochtaPostOffices({ query: { postal_code: "190-000" }, ip: "192.0.2.10" } as unknown as MedusaRequest, res);
      expect(res.statusCode).toBe(400);
      expect(lookup).not.toHaveBeenCalled();
    });
  });

  describe("POST /store/pochta/calculate", () => {
    it("returns 503 when module is not configured", async () => {
      setPochtaDisabledEnv();

      const req = {
        body: { to_index: "190000", weight: 1200, length: 30, width: 20, height: 10 },
        ip: "192.0.2.9",
      } as unknown as MedusaRequest;
      const res = createMockResponse();

      await calculatePochta(req, res);

      expect(res.statusCode).toBe(503);
      expect(res.body).toEqual({ message: "Delivery service unavailable" });
    });

    it("calculates parcel and courier rates with customer_cost 0 via client", async () => {
      setPochtaEnabledEnv();

      jest.spyOn(PochtaClient.prototype, "calculateTariff").mockImplementation(async ({ isCourier }) => {
        if (isCourier) {
          return { total_rate_rubles: 490, vat_rubles: 98, delivery_time_days_min: 2, delivery_time_days_max: 3, mail_type: "ONLINE_COURIER" };
        }
        return { total_rate_rubles: 290, vat_rubles: 58, delivery_time_days_min: 3, delivery_time_days_max: 5, mail_type: "ONLINE_PARCEL" };
      });

      const req = { body: { to_index: "190000", weight: 1200, length: 30, width: 20, height: 10 }, ip: "192.0.2.11" } as unknown as MedusaRequest;
      const res = createMockResponse();

      await calculatePochta(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.body).toEqual({
        parcel: expect.objectContaining({ total_rate_rubles: 290 }),
        courier: expect.objectContaining({ total_rate_rubles: 490 }),
        customer_cost: 0,
      });
    });

    it("rejects malformed and out-of-bounds calculation input", async () => {
      setPochtaEnabledEnv();

      const calcSpy = jest.spyOn(PochtaClient.prototype, "calculateTariff").mockResolvedValue({
        total_rate_rubles: 300,
        vat_rubles: 60,
        delivery_time_days_min: 3,
        delivery_time_days_max: 5,
        mail_type: "ONLINE_PARCEL",
      });

      const req = { body: { to_index: "190-000-A", weight: Number.POSITIVE_INFINITY, length: 0, width: 20, height: 10 }, ip: "192.0.2.12" } as unknown as MedusaRequest;
      const res = createMockResponse();

      await calculatePochta(req, res);

      expect(calcSpy).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(400);
      expect(res.body).toEqual({ message: "Invalid request" });
    });

    it("fails the whole calculation with a generic 502 when one tariff fails", async () => {
      setPochtaEnabledEnv();
      jest.spyOn(PochtaClient.prototype, "calculateTariff").mockRejectedValue(new Error("token leaked"));
      const res = createMockResponse();
      await calculatePochta({ body: { to_index: "190000", weight: 1200, length: 30, width: 20, height: 10 }, ip: "192.0.2.13" } as unknown as MedusaRequest, res);
      expect(res.statusCode).toBe(502);
      expect(res.body).toEqual({ message: "Delivery provider unavailable" });
    });

    it("returns 429 after the per-client request budget is exhausted", async () => {
      setPochtaEnabledEnv();
      jest.spyOn(PochtaClient.prototype, "calculateTariff").mockResolvedValue({
        total_rate_rubles: 300,
        vat_rubles: 60,
        delivery_time_days_min: 2,
        delivery_time_days_max: 4,
        mail_type: "ONLINE_PARCEL",
      });
      const request = {
        body: { to_index: "190000", weight: 1200, length: 30, width: 20, height: 10 },
        ip: "198.51.100.30",
      } as unknown as MedusaRequest;
      for (let index = 0; index < 30; index += 1) {
        await calculatePochta(request, createMockResponse());
      }
      const rejected = createMockResponse();
      await calculatePochta(request, rejected);
      expect(rejected.statusCode).toBe(429);
      expect(rejected.body).toEqual({ message: "Too many requests" });
    });

    it("coalesces concurrent identical tariff requests", async () => {
      setPochtaEnabledEnv();
      const pending = deferred<Awaited<ReturnType<PochtaClient["calculateTariff"]>>>();
      const calculate = jest.spyOn(PochtaClient.prototype, "calculateTariff").mockReturnValue(pending.promise);
      const request = {
        body: { to_index: "190000", weight: 1200, length: 30, width: 20, height: 10 },
        ip: "203.0.113.20",
      } as unknown as MedusaRequest;
      const firstResponse = createMockResponse();
      const secondResponse = createMockResponse();
      const first = calculatePochta(request, firstResponse);
      const second = calculatePochta({ ...request, ip: "203.0.113.21" } as MedusaRequest, secondResponse);
      await Promise.resolve();
      expect(calculate).toHaveBeenCalledTimes(2);
      pending.resolve({
        total_rate_rubles: 300,
        vat_rubles: 60,
        delivery_time_days_min: 2,
        delivery_time_days_max: 4,
        mail_type: "ONLINE_PARCEL",
      });
      await Promise.all([first, second]);
      expect(firstResponse.body).toEqual(secondResponse.body);
    });
  });
});
