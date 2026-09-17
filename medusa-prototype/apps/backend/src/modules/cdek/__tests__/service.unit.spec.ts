import CdekFulfillmentProviderService, {
  MOSCOW_PICKUP_STORES,
} from "../service";
import {
  CDEK_OPTION_COURIER,
  CDEK_OPTION_PICKUP,
  CDEK_OPTION_PVZ,
} from "../provider-id";
import type { CdekProviderOptions } from "../config";

const TEST_OPTIONS: CdekProviderOptions = {
  clientId: "mock-id",
  clientSecret: "mock-secret",
  apiBaseUrl: "https://api.edu.cdek.ru/v2",
  fromCityCode: 44,
};

describe("CdekFulfillmentProviderService", () => {
  let service: CdekFulfillmentProviderService;

  beforeEach(() => {
    service = new CdekFulfillmentProviderService({}, TEST_OPTIONS);
  });

  it("returns available fulfillment options including PVZ, courier and pickup", async () => {
    const options = await service.getFulfillmentOptions();
    const ids = options.map((o) => o.id);
    expect(ids).toContain(CDEK_OPTION_PVZ);
    expect(ids).toContain(CDEK_OPTION_COURIER);
    expect(ids).toContain(CDEK_OPTION_PICKUP);
  });

  it("validates known fulfillment options", async () => {
    expect(await service.validateOption({ id: CDEK_OPTION_PVZ })).toBe(true);
    expect(await service.validateOption({ id: CDEK_OPTION_COURIER })).toBe(true);
    expect(await service.validateOption({ id: CDEK_OPTION_PICKUP })).toBe(true);
    expect(await service.validateOption({ id: "unknown_option" })).toBe(false);
  });

  it("validates fulfillment data for PVZ option", async () => {
    const context = {} as any;
    const validated = await service.validateFulfillmentData(
      { id: CDEK_OPTION_PVZ },
      { cdek_pvz_code: "MSK65", cdek_pvz_address: "ул. Динамовская, 1А" },
      context,
    );
    expect(validated.cdek_pvz_code).toBe("MSK65");
    expect(validated.cdek_pvz_address).toBe("ул. Динамовская, 1А");
  });

  it("validates fulfillment data for store pickup and defaults to first store if not specified", async () => {
    const context = {} as any;
    const validated = await service.validateFulfillmentData(
      { id: CDEK_OPTION_PICKUP },
      {},
      context,
    );
    expect(validated.pickup_store_id).toBe("store_vodny");
    expect(validated.pickup_store_name).toBe("ТЦ «Водный»");
  });

  it("calculates 0 RUB price for store pickup", async () => {
    const price = await service.calculatePrice(
      { id: CDEK_OPTION_PICKUP },
      {},
      {},
    );
    expect(price.calculated_amount).toBe(0);
    expect(price.is_calculated_price_tax_inclusive).toBe(true);
  });

  it("calculates launch promo price (0 RUB) for CDEK PVZ", async () => {
    const price = await service.calculatePrice(
      { id: CDEK_OPTION_PVZ },
      { city_code: 44 },
      {},
    );
    expect(price.calculated_amount).toBe(0);
  });

  it("creates store pickup fulfillment without external CDEK call", async () => {
    const result = await service.createFulfillment(
      { pickup_store_id: "store_nebo", pickup_store_name: "ТЦ «Небо»" },
      [],
      { id: "ord_123" },
      { shipping_option_id: CDEK_OPTION_PICKUP },
    );
    expect(result.data.delivery_mode).toBe("pickup");
    expect(result.data.store).toBe("ТЦ «Небо»");
    expect(result.labels).toHaveLength(0);
  });
});
