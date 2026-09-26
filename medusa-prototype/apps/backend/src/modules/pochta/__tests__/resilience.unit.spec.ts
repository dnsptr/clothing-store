import { PochtaClient, PochtaApiError } from "../lib/pochta-client";
import PochtaFulfillmentProviderService from "../service";
import { POCHTA_OPTION_PARCEL, POCHTA_OPTION_COURIER } from "../provider-id";
import type { PochtaProviderOptions } from "../config";

const TEST_OPTIONS: PochtaProviderOptions = {
  accessToken: "test_token",
  userKey: "test_key",
  apiBaseUrl: "https://otpravka-api.pochta.ru/1.0",
  fromIndex: "119571",
};

describe("Russian Post (Pochta) Resilience, Limits & Boundary Tests", () => {
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  describe("Postal Code Validation & Boundaries", () => {
    it("validates 6-digit Russian postal index strictly", () => {
      const isValidPochtaIndex = (raw: string) => /^\d{6}$/.test(raw.trim()) && raw.trim() !== "000000";

      expect(isValidPochtaIndex("101000")).toBe(true);
      expect(isValidPochtaIndex("190000")).toBe(true);
      expect(isValidPochtaIndex("119571")).toBe(true);
      expect(isValidPochtaIndex("000000")).toBe(false); // Invalid zero index
      expect(isValidPochtaIndex("10100")).toBe(false); // 5 digits
      expect(isValidPochtaIndex("1010001")).toBe(false); // 7 digits
      expect(isValidPochtaIndex("101-00")).toBe(false); // dash
      expect(isValidPochtaIndex("10100A")).toBe(false); // letter
    });

    it("validates package weight limits for standard Russian Post parcels", () => {
      const POCHTA_STANDARD_MAX_KG = 10;
      const POCHTA_HEAVY_MAX_KG = 20;

      const getPochtaCategory = (weightKg: number) => {
        if (weightKg <= 0 || weightKg > POCHTA_HEAVY_MAX_KG) return "unsupported";
        if (weightKg <= POCHTA_STANDARD_MAX_KG) return "standard";
        return "heavy";
      };

      expect(getPochtaCategory(0.8)).toBe("standard");
      expect(getPochtaCategory(9.9)).toBe("standard");
      expect(getPochtaCategory(10.0)).toBe("standard");
      expect(getPochtaCategory(15.0)).toBe("heavy");
      expect(getPochtaCategory(20.0)).toBe("heavy");
      expect(getPochtaCategory(25.0)).toBe("unsupported"); // Requires cargo/freight
    });
  });

  describe("API Error Responses & Resilience", () => {
    it("propagates a 400 tariff rejection", async () => {
      global.fetch = jest.fn(async () => {
        return {
          ok: false,
          status: 400,
          statusText: "Bad Request",
          text: async () => JSON.stringify({ error: "index-to not found" }),
          json: async () => ({ error: "index-to not found" }),
        } as unknown as Response;
      });

      const client = new PochtaClient(TEST_OPTIONS);
      await expect(client.calculateTariff({
        toIndex: "999999", weightGrams: 1000, lengthCm: 30, widthCm: 20, heightCm: 10,
      })).rejects.toBeInstanceOf(PochtaApiError);
    });

    it("propagates a non-JSON 500 tariff rejection", async () => {
      global.fetch = jest.fn(async () => {
        return {
          ok: false,
          status: 500,
          statusText: "Internal Server Error",
          text: async () => "Internal Server Error",
          json: async () => ({ message: "Internal Server Error" }),
        } as unknown as Response;
      });

      const client = new PochtaClient(TEST_OPTIONS);
      await expect(client.calculateTariff({
        toIndex: "101000", weightGrams: 1000, lengthCm: 30, widthCm: 20, heightCm: 10, isCourier: true,
      })).rejects.toBeInstanceOf(PochtaApiError);
    });

    it("propagates batch order creation failure", async () => {
      global.fetch = jest.fn(async () => {
        return {
          ok: false,
          status: 400,
          statusText: "Bad Request",
          text: async () => JSON.stringify({ errors: ["Recipient address invalid"] }),
          json: async () => ({ errors: ["Recipient address invalid"] }),
        } as unknown as Response;
      });

      const client = new PochtaClient(TEST_OPTIONS);
      await expect(client.createBacklogOrder({
        orderNumber: "ord_fail_1",
        toIndex: "101000",
        recipientAddress: "Несуществующий адрес",
        recipientName: "Иван Иванов",
        recipientPhone: "+79991234567",
        weightGrams: 1000,
        lengthCm: 30,
        widthCm: 20,
        heightCm: 10,
      })).rejects.toBeInstanceOf(PochtaApiError);
    });

    it("throws PochtaApiError when low-level request() fails", async () => {
      global.fetch = jest.fn(async () => {
        return {
          ok: false,
          status: 403,
          statusText: "Forbidden",
          text: async () => JSON.stringify({ desc: "Access denied" }),
          json: async () => ({ desc: "Access denied" }),
        } as unknown as Response;
      });

      const client = new PochtaClient(TEST_OPTIONS);
      await expect(client.calculateTariff({
        toIndex: "101000", weightGrams: 1000, lengthCm: 30, widthCm: 20, heightCm: 10,
      })).rejects.toThrow(PochtaApiError);
    });
  });

  describe("Service Idempotency & Cancellation", () => {
    it("fails explicitly because Pochta cancellation is unsupported", async () => {
      const service = new PochtaFulfillmentProviderService({}, TEST_OPTIONS);
      await expect(service.cancelFulfillment({
        data: { delivery_mode: "pochta_parcel", barcode: "80088812345678" },
      })).rejects.toThrow("Russian Post fulfillment cancellation is unsupported");
    });
  });
});
