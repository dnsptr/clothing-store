import { CdekClient, CdekApiError } from "../lib/cdek-client";
import CdekFulfillmentProviderService from "../service";
import { CDEK_OPTION_PVZ, CDEK_OPTION_PICKUP } from "../provider-id";
import type { CdekProviderOptions } from "../config";
import { UnsupportedCdekCancellationError } from "../fulfillment-data";

const TEST_OPTIONS: CdekProviderOptions = {
  clientId: "test-id",
  clientSecret: "test-secret",
  apiBaseUrl: "https://api.edu.cdek.ru/v2",
  fromCityCode: 44,
};

describe("CDEK Resilience, Limits & Boundary Tests", () => {
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  describe("Volumetric Weight & Package Boundaries", () => {
    // Formula: (L x W x H) / 5000 (cm -> kg)
    const calculateChargeableWeightKg = (
      physicalWeightGrams: number,
      lengthCm: number,
      widthCm: number,
      heightCm: number,
      divisor = 5000,
    ): number => {
      const physicalKg = physicalWeightGrams / 1000;
      const volumetricKg = (lengthCm * widthCm * heightCm) / divisor;
      return Math.max(physicalKg, volumetricKg);
    };

    it("chooses volumetric weight when item is bulky but lightweight (e.g. winter coat)", () => {
      // 1200g, box 60 x 50 x 40 cm -> volumetric is (60 * 50 * 40) / 5000 = 24 kg
      const chargeable = calculateChargeableWeightKg(1200, 60, 50, 40);
      expect(chargeable).toBe(24);
    });

    it("chooses physical weight when item is dense (e.g. leather boots)", () => {
      // 3500g, box 30 x 20 x 15 cm -> volumetric is (30 * 20 * 15) / 5000 = 1.8 kg
      const chargeable = calculateChargeableWeightKg(3500, 30, 20, 15);
      expect(chargeable).toBe(3.5);
    });

    it("validates CDEK standard tariff package dimensions limits", () => {
      const CDEK_MAX_SIDE_CM = 120;
      const CDEK_MAX_SUM_DIMENSIONS_CM = 150;

      const isPackageAcceptable = (l: number, w: number, h: number) => {
        if (l > CDEK_MAX_SIDE_CM || w > CDEK_MAX_SIDE_CM || h > CDEK_MAX_SIDE_CM) return false;
        if (l + w + h > CDEK_MAX_SUM_DIMENSIONS_CM) return false;
        return true;
      };

      expect(isPackageAcceptable(100, 30, 15)).toBe(true); // Sum = 145 <= 150
      expect(isPackageAcceptable(125, 10, 10)).toBe(false); // Length > 120
      expect(isPackageAcceptable(60, 60, 40)).toBe(false); // Sum = 160 > 150
    });

    it("validates CDEK postamat cell dimension limits", () => {
      // Standard CDEK postamat max cell: 36 x 37 x 49 cm, max 15kg
      const POSTAMAT_MAX_W = 36;
      const POSTAMAT_MAX_H = 37;
      const POSTAMAT_MAX_D = 49;
      const POSTAMAT_MAX_WEIGHT_KG = 15;

      const fitsPostamat = (w: number, h: number, d: number, weightKg: number) => {
        const sortedDims = [w, h, d].sort((a, b) => a - b);
        const cellDims = [POSTAMAT_MAX_W, POSTAMAT_MAX_H, POSTAMAT_MAX_D].sort((a, b) => a - b);
        return (
          sortedDims[0] <= cellDims[0] &&
          sortedDims[1] <= cellDims[1] &&
          sortedDims[2] <= cellDims[2] &&
          weightKg <= POSTAMAT_MAX_WEIGHT_KG
        );
      };

      expect(fitsPostamat(30, 20, 15, 3.5)).toBe(true);
      expect(fitsPostamat(35, 35, 45, 12)).toBe(true);
      expect(fitsPostamat(40, 40, 50, 5)).toBe(false); // Exceeds dimensions
      expect(fitsPostamat(30, 20, 15, 16)).toBe(false); // Exceeds 15kg limit
    });
  });

  describe("Network Resilience & Error Handling", () => {
    it("handles 504 Gateway Timeout gracefully in CdekClient", async () => {
      global.fetch = jest.fn(async (url: RequestInfo | URL) => {
        const urlStr = String(url);
        if (urlStr.includes("/oauth/token")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ access_token: "test_token", expires_in: 3600 }),
            text: async () => JSON.stringify({ access_token: "test_token", expires_in: 3600 }),
          } as unknown as Response;
        }
        return {
          ok: false,
          status: 504,
          statusText: "Gateway Timeout",
          text: async () => "Gateway Timeout",
          json: async () => ({ message: "Gateway Timeout" }),
        } as unknown as Response;
      });

      const client = new CdekClient(TEST_OPTIONS);
      await expect(client.searchCities("Москва")).rejects.toThrow(CdekApiError);
    });

    it("handles 500 Internal Server Error in CdekClient", async () => {
      global.fetch = jest.fn(async (url: RequestInfo | URL) => {
        const urlStr = String(url);
        if (urlStr.includes("/oauth/token")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ access_token: "test_token", expires_in: 3600 }),
            text: async () => JSON.stringify({ access_token: "test_token", expires_in: 3600 }),
          } as unknown as Response;
        }
        return {
          ok: false,
          status: 500,
          statusText: "Internal Server Error",
          text: async () => "Internal Server Error",
          json: async () => ({ message: "Internal Server Error" }),
        } as unknown as Response;
      });

      const client = new CdekClient(TEST_OPTIONS);
      await expect(client.getDeliveryPoints(44)).rejects.toThrow(CdekApiError);
    });

    it("handles concurrent requests with expired token without duplicate oauth calls", async () => {
      let oauthCallCount = 0;
      global.fetch = jest.fn(async (url: RequestInfo | URL) => {
        const urlStr = String(url);
        if (urlStr.includes("/oauth/token")) {
          oauthCallCount++;
          // Simulate network delay
          await new Promise((resolve) => setTimeout(resolve, 50));
          return {
            ok: true,
            status: 200,
            json: async () => ({ access_token: "single-token", expires_in: 3600 }),
            text: async () => JSON.stringify({ access_token: "single-token", expires_in: 3600 }),
          } as unknown as Response;
        }
        return {
          ok: true,
          status: 200,
          json: async () => [{ code: 44, city: "Москва" }],
          text: async () => JSON.stringify([{ code: 44, city: "Москва" }]),
        } as unknown as Response;
      });

      const client = new CdekClient(TEST_OPTIONS);
      // Run 5 requests in parallel
      const results = await Promise.all([
        client.searchCities("Москва"),
        client.searchCities("Питер"),
        client.searchCities("Казань"),
        client.searchCities("Самара"),
        client.searchCities("Уфа"),
      ]);

      expect(results).toHaveLength(5);
      // Token was requested only once and shared across all 5 concurrent calls
      expect(oauthCallCount).toBe(1);
    });
  });

  describe("Cancellation", () => {
    it("rejects cancellation until a verified carrier operation is modeled", async () => {
      const service = new CdekFulfillmentProviderService({}, TEST_OPTIONS);
      await expect(service.cancelFulfillment({
        data: { delivery_mode: "pickup", store: "ТЦ «Водный»" },
      })).rejects.toThrow(UnsupportedCdekCancellationError);
    });

    it("does not report mock carrier order cancellation as successful", async () => {
      const service = new CdekFulfillmentProviderService({}, TEST_OPTIONS);
      await expect(service.cancelFulfillment({
        data: { cdek_order_uuid: "mock_uuid_123" },
      })).rejects.toThrow(UnsupportedCdekCancellationError);
    });
  });
});
