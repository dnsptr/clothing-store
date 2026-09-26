import CdekFulfillmentProviderService, {
  MOSCOW_PICKUP_STORES,
} from "../service";
import {
  CDEK_OPTION_COURIER,
  CDEK_OPTION_PICKUP,
  CDEK_OPTION_PVZ,
} from "../provider-id";
import type { CdekProviderOptions } from "../config";
import {
  CdekFulfillmentDataError,
  UnsupportedCdekCancellationError,
  UnsupportedCdekReturnError,
} from "../fulfillment-data";

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
    expect(options.some((option) => option.is_return)).toBe(false);
  });

  it("validates known fulfillment options", async () => {
    expect(await service.validateOption({ id: CDEK_OPTION_PVZ })).toBe(true);
    expect(await service.validateOption({ id: CDEK_OPTION_COURIER })).toBe(true);
    expect(await service.validateOption({ id: CDEK_OPTION_PICKUP })).toBe(true);
    expect(await service.validateOption({ id: "unknown_option" })).toBe(false);
  });

  it("rejects unknown fulfillment and pricing options without carrier calls", async () => {
    const getDeliveryPoints = jest.spyOn(service.getCdekClient(), "getDeliveryPoints");
    const calculateTariff = jest.spyOn(service.getCdekClient(), "calculateTariff");

    await expect(service.validateFulfillmentData({ id: "unknown_option" }, {}, {} as any)).rejects.toThrow(CdekFulfillmentDataError);
    await expect(service.calculatePrice({ id: "unknown_option" }, {}, {})).rejects.toThrow(CdekFulfillmentDataError);
    expect(getDeliveryPoints).not.toHaveBeenCalled();
    expect(calculateTariff).not.toHaveBeenCalled();
  });

  it("validates fulfillment data for PVZ option", async () => {
    jest.spyOn(service.getCdekClient(), "getDeliveryPoints").mockResolvedValue([
      {
        code: "MSK65",
        name: "ПВЗ Динамовская",
        type: "PVZ",
        location: {
          address: "ул. Динамовская, 1А",
          city_code: 44,
          city: "Москва",
        },
        work_time: "10:00-20:00",
        phones: [],
      },
    ]);
    jest.spyOn(service.getCdekClient(), "calculateTariff").mockResolvedValue({
      tariff_code: 136,
      tariff_name: "СДЭК — Доставка в пункт выдачи (ПВЗ)",
      delivery_sum: 300,
      period_min: 1,
      period_max: 3,
    });
    const context = { items: [{ id: "item_1", quantity: 1, variant: { weight: 500, length: 20, width: 10, height: 5 } }] } as any;
    const validated = await service.validateFulfillmentData(
      { id: CDEK_OPTION_PVZ },
      {
        city_code: 44,
        cdek_pvz_code: "MSK65",
        cdek_pvz_address: "Подменённый адрес",
      },
      context,
    );
    expect(validated.cdek_pvz_code).toBe("MSK65");
    expect(validated.cdek_pvz_address).toBe("ул. Динамовская, 1А");
    expect(validated.city_code).toBe(44);
    expect(validated).toMatchObject({
      carrier_quote_amount: 300,
      carrier_quote_currency: "RUB",
      carrier_quote_provider: "cdek",
      carrier_quote_tariff_code: 136,
    });
  });

  it("rejects a PVZ code that CDEK does not return for the destination city", async () => {
    jest.spyOn(service.getCdekClient(), "getDeliveryPoints").mockResolvedValue([]);

    await expect(service.validateFulfillmentData(
      { id: CDEK_OPTION_PVZ },
      { city_code: 44, cdek_pvz_code: "FAKE-PVZ" },
      {} as any,
    )).rejects.toThrow("FAKE-PVZ");
  });

  it("stores the carrier quote for courier delivery", async () => {
    const calculateTariff = jest
      .spyOn(service.getCdekClient(), "calculateTariff")
      .mockResolvedValue({
        tariff_code: 137,
        tariff_name: "СДЭК — Курьерская доставка до двери",
        delivery_sum: 500,
        period_min: 1,
        period_max: 2,
      });

    const validated = await service.validateFulfillmentData(
      { id: CDEK_OPTION_COURIER },
      { city_code: 137, delivery_address: "Невский проспект, 1" },
      { items: [{ id: "item_1", quantity: 1, variant: { weight: 500, length: 20, width: 10, height: 5 } }] } as any,
    );

    expect(validated).toMatchObject({
      city_code: 137,
      delivery_address: "Невский проспект, 1",
      carrier_quote_amount: 500,
      carrier_quote_currency: "RUB",
      carrier_quote_provider: "cdek",
      carrier_quote_tariff_code: 137,
    });
    expect(calculateTariff).toHaveBeenCalledWith(expect.objectContaining({ tariffCode: 137 }));
  });

  it("requires an explicit pickup store ID", async () => {
    const context = {} as any;
    await expect(service.validateFulfillmentData(
      { id: CDEK_OPTION_PICKUP },
      {},
      context,
    )).rejects.toThrow("pickup_store_id");
  });

  it("rejects an unknown pickup store instead of substituting another store", async () => {
    await expect(service.validateFulfillmentData(
      { id: CDEK_OPTION_PICKUP },
      { pickup_store_id: "store_fake" },
      {} as any,
    )).rejects.toThrow("store_fake");
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

  it("keeps PVZ free for the customer after the carrier tariff succeeds", async () => {
    const calculateTariff = jest.spyOn(service.getCdekClient(), "calculateTariff").mockResolvedValue({
      tariff_code: 136,
      tariff_name: "СДЭК — Доставка в пункт выдачи (ПВЗ)",
      delivery_sum: 300,
      period_min: 1,
      period_max: 3,
    });
    const price = await service.calculatePrice(
      { id: CDEK_OPTION_PVZ },
      { city_code: 44 },
      { items: [{ id: "item_1", quantity: 2, variant: { weight: 500, length: 20, width: 10, height: 5 } }] },
    );
    expect(calculateTariff).toHaveBeenCalledWith(expect.objectContaining({
      tariffCode: 136,
      toCityCode: 44,
      packages: [{ weight: 1000, length: 20, width: 10, height: 5 }],
    }));
    expect(price.calculated_amount).toBe(0);
    expect(price.is_calculated_price_tax_inclusive).toBe(true);
  });

  it("keeps courier delivery free for the customer after the carrier tariff succeeds", async () => {
    const calculateTariff = jest.spyOn(service.getCdekClient(), "calculateTariff").mockResolvedValue({
      tariff_code: 137,
      tariff_name: "СДЭК — Курьерская доставка до двери",
      delivery_sum: 540.5,
      period_min: 1,
      period_max: 2,
    });
    const price = await service.calculatePrice(
      { id: CDEK_OPTION_COURIER },
      { city_code: 137, delivery_address: "Невский проспект, 1" },
      { items: [{ id: "item_1", quantity: 1, product: { weight: 700, length: 30, width: 25, height: 10 } }] },
    );
    expect(calculateTariff).toHaveBeenCalledWith(expect.objectContaining({ tariffCode: 137, toCityCode: 137 }));
    expect(price.calculated_amount).toBe(0);
  });

  it("rejects CDEK pricing before the carrier call when cart data is invalid", async () => {
    const calculateTariff = jest.spyOn(service.getCdekClient(), "calculateTariff");
    await expect(service.calculatePrice(
      { id: CDEK_OPTION_PVZ },
      {},
      { items: [{ id: "item_1", quantity: 1, variant: { weight: 500, length: 20, width: 10, height: 5 } }] },
    )).rejects.toThrow(CdekFulfillmentDataError);
    await expect(service.calculatePrice(
      { id: "cdek-return" },
      { city_code: 44 },
      { items: [{ id: "item_1", quantity: 1, variant: { weight: 500, length: 20, width: 10, height: 5 } }] },
    )).rejects.toThrow("option");
    expect(calculateTariff).not.toHaveBeenCalled();
  });

  it("propagates a CDEK tariff failure instead of returning free shipping", async () => {
    jest.spyOn(service.getCdekClient(), "calculateTariff").mockRejectedValue(new Error("CDEK tariff unavailable"));
    await expect(service.calculatePrice(
      { id: CDEK_OPTION_PVZ },
      { city_code: 44 },
      { items: [{ id: "item_1", quantity: 1, variant: { weight: 500, length: 20, width: 10, height: 5 } }] },
    )).rejects.toThrow("CDEK tariff unavailable");
  });

  it("creates store pickup fulfillment without external CDEK call", async () => {
    const createOrder = jest.spyOn(service.getCdekClient(), "createOrder");
    const result = await service.createFulfillment(
      {
        delivery_mode: CDEK_OPTION_PICKUP,
        pickup_store_id: "store_nebo",
        pickup_store_name: "ТЦ «Небо»",
        pickup_store_address: "г. Москва, ул. Авиаторов, д. 3А",
      },
      [],
      { id: "ord_123" },
      { shipping_option_id: "so_pickup" },
    );
    expect(result.data.delivery_mode).toBe("pickup");
    expect(result.data.store).toBe("ТЦ «Небо»");
    expect(result.labels).toHaveLength(0);
    expect(createOrder).not.toHaveBeenCalled();
  });

  it("creates a PVZ order with the validated delivery point", async () => {
    const createOrder = jest.spyOn(service.getCdekClient(), "createOrder").mockResolvedValue({
      entity: { uuid: "cdek-pvz-uuid" },
      requests: [],
    });

    const result = await service.createFulfillment(
      {
        delivery_mode: CDEK_OPTION_PVZ,
        city_code: 44,
        cdek_pvz_code: "MSK65",
        cdek_pvz_address: "ул. Динамовская, 1А",
      },
      [{ line_item_id: "item_1", quantity: 1 }],
      {
        id: "ord_123",
        email: "buyer@example.com",
        shipping_address: { first_name: "Иван", last_name: "Иванов", phone: "+79991234567" },
        items: [{ id: "item_1", variant: { weight: 700, length: 30, width: 25, height: 10 } }],
      },
      { shipping_option_id: "so_cdek_pvz" },
    );

    expect(createOrder).toHaveBeenCalledWith(expect.objectContaining({
      tariffCode: 136,
      deliveryPoint: "MSK65",
      toAddress: undefined,
    }));
    expect(result.labels[0]?.tracking_number).toBe("cdek-pvz-uuid");
  });

  it("creates a courier order with destination city code and address", async () => {
    const createOrder = jest.spyOn(service.getCdekClient(), "createOrder").mockResolvedValue({
      entity: { uuid: "cdek-courier-uuid" },
      requests: [],
    });

    await service.createFulfillment(
      {
        delivery_mode: CDEK_OPTION_COURIER,
        city_code: 137,
        delivery_address: "Невский проспект, 1, кв. 2",
      },
      [{ line_item_id: "item_1", quantity: 1 }],
      {
        id: "ord_456",
        shipping_address: { first_name: "Анна", phone: "+79997654321" },
        items: [{ id: "item_1", variant: { weight: 700, length: 30, width: 25, height: 10 } }],
      },
      { shipping_option_id: "so_cdek_courier" },
    );

    expect(createOrder).toHaveBeenCalledWith(expect.objectContaining({
      tariffCode: 137,
      deliveryPoint: undefined,
      toAddress: {
        cityCode: 137,
        address: "Невский проспект, 1, кв. 2",
      },
    }));
  });

  it("fails closed when CDEK rejects shipment creation", async () => {
    jest.spyOn(service.getCdekClient(), "createOrder").mockRejectedValue(
      new Error("CDEK unavailable"),
    );

    await expect(service.createFulfillment(
      {
        delivery_mode: CDEK_OPTION_PVZ,
        city_code: 44,
        cdek_pvz_code: "MSK65",
        cdek_pvz_address: "ул. Динамовская, 1А",
      },
      [{ line_item_id: "item_1", quantity: 1 }],
      { id: "ord_789", shipping_address: { first_name: "Иван", phone: "+79991234567" }, items: [{ id: "item_1", variant: { weight: 700, length: 30, width: 25, height: 10 } }] },
      { shipping_option_id: "so_cdek_pvz" },
    )).rejects.toThrow("CDEK unavailable");
  });

  it("rejects shipment creation without a real order identity", async () => {
    await expect(service.createFulfillment(
      {
        delivery_mode: CDEK_OPTION_PVZ,
        city_code: 44,
        cdek_pvz_code: "MSK65",
      },
      [],
      { shipping_address: { first_name: "Иван", phone: "+79991234567" } },
      { shipping_option_id: "so_cdek_pvz" },
    )).rejects.toThrow("order identity");
  });

  it("derives aggregate package data from authoritative order item fields", async () => {
    const createOrder = jest.spyOn(service.getCdekClient(), "createOrder").mockResolvedValue({
      entity: { uuid: "cdek-uuid" },
      requests: [{ request_uuid: "request-uuid", type: "CREATE", state: "ACCEPTED", date_time: "2026-09-21T00:00:00+0000" }],
    });

    await service.createFulfillment(
      { delivery_mode: CDEK_OPTION_PVZ, city_code: 44, cdek_pvz_code: "MSK65" },
      [{ line_item_id: "item_1", quantity: 2 }, { line_item_id: "item_2", quantity: 1 }],
      { id: "ord_999", shipping_address: { first_name: "Иван", phone: "+79991234567" }, items: [
        { id: "item_1", variant: { weight: 500, length: 20, width: 10, height: 5 } },
        { id: "item_2", variant: { product: { weight: 700, length: 30, width: 25, height: 10 } } },
      ] },
      {},
    );

    expect(createOrder).toHaveBeenCalledWith(expect.objectContaining({ packages: [{ number: "1", weight: 1700, length: 30, width: 25, height: 10 }] }));
  });

  it("rejects duplicate, unmatched, or oversized fulfillment package data before carrier mutation", async () => {
    const createOrder = jest.spyOn(service.getCdekClient(), "createOrder");
    const baseOrder = { id: "ord_999", shipping_address: { first_name: "Иван", phone: "+79991234567" }, items: [{ id: "item_1", variant: { weight: 500, length: 20, width: 10, height: 5 } }] };
    const data = { delivery_mode: CDEK_OPTION_PVZ, city_code: 44, cdek_pvz_code: "MSK65" };

    await expect(service.createFulfillment(data, [{ line_item_id: "item_1", quantity: 1 }, { line_item_id: "item_1", quantity: 1 }], baseOrder, {})).rejects.toThrow("fulfillment items");
    await expect(service.createFulfillment(data, [{ line_item_id: "missing", quantity: 1 }], baseOrder, {})).rejects.toThrow("unmatched line item");
    await expect(service.createFulfillment(data, [{ line_item_id: "item_1", quantity: 100 }], baseOrder, {})).rejects.toThrow("package");
    expect(createOrder).not.toHaveBeenCalled();
  });

  it("rejects unsupported cancellation and returns", async () => {
    await expect(service.cancelFulfillment({})).rejects.toThrow(UnsupportedCdekCancellationError);
    await expect(service.createReturnFulfillment()).rejects.toThrow(UnsupportedCdekReturnError);
  });
});
