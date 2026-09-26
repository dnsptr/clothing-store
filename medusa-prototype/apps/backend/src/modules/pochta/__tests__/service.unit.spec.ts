import PochtaFulfillmentProviderService from "../service";
import {
  POCHTA_OPTION_COURIER,
  POCHTA_OPTION_PARCEL,
} from "../provider-id";
import type { PochtaProviderOptions } from "../config";

const TEST_OPTIONS: PochtaProviderOptions = {
  accessToken: "test_token",
  userKey: "test_key",
  apiBaseUrl: "https://otpravka-api.pochta.ru/1.0",
  fromIndex: "119571",
};

const FULFILLMENT_ITEMS = [
  { line_item_id: "item_coat", quantity: 2 },
  { line_item_id: "item_scarf", quantity: 1 },
];
const ORDER = {
  id: "ord_pochta_1",
  display_id: 1001,
  items: [{
    id: "item_coat",
    variant: { weight: 500, length: 30, width: 20, height: 10 },
  }, {
    id: "item_scarf",
    product: { weight: 300, length: 25, width: 22, height: 12 },
  }],
  shipping_address: {
    first_name: "Петр",
    last_name: "Петров",
    phone: "+79260001122",
    address_1: "Ленинский, 156",
    city: "Москва",
    postal_code: "119571",
  },
};

const PARCEL_DATA = {
  delivery_mode: POCHTA_OPTION_PARCEL,
  postal_code: "119571",
  post_office_address: "Ленинский, 156",
};
const COURIER_DATA = {
  delivery_mode: POCHTA_OPTION_COURIER,
  postal_code: "119571",
  delivery_address: "Москва, Ленинский, 156",
};
const MEDUSA_SHIPPING_OPTION = { shipping_option_id: "so_pochta_123" };

describe("PochtaFulfillmentProviderService", () => {
  let service: PochtaFulfillmentProviderService;
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  beforeEach(() => {
    service = new PochtaFulfillmentProviderService({}, TEST_OPTIONS);
  });

  it("returns available fulfillment options for parcel and courier", async () => {
    const options = await service.getFulfillmentOptions();
    const ids = options.map((o) => o.id);
    expect(ids).toContain(POCHTA_OPTION_PARCEL);
    expect(ids).toContain(POCHTA_OPTION_COURIER);
  });

  it("validates known fulfillment options", async () => {
    expect(await service.validateOption({ id: POCHTA_OPTION_PARCEL })).toBe(true);
    expect(await service.validateOption({ id: POCHTA_OPTION_COURIER })).toBe(true);
    expect(await service.validateOption({ id: "unknown_pochta" })).toBe(false);
  });

  it("stores the carrier quote for a post office parcel", async () => {
    jest.spyOn(service.getPochtaClient(), "calculateTariff").mockResolvedValue({
      total_rate_rubles: 350.5,
      vat_rubles: 70,
      delivery_time_days_min: 2,
      delivery_time_days_max: 4,
      mail_type: "ONLINE_PARCEL",
    });
    const context = { items: [{ id: "item_coat", quantity: 1, variant: { weight: 500, length: 30, width: 20, height: 10 } }] } as any;
    const validated = await service.validateFulfillmentData(
      { id: POCHTA_OPTION_PARCEL },
      { postal_code: "101000", post_office_address: "Москва, Мясницкая, 26", delivery_mode: POCHTA_OPTION_COURIER },
      context,
    );
    expect(validated.postal_code).toBe("101000");
    expect(validated.post_office_address).toBe("Москва, Мясницкая, 26");
    expect(validated.delivery_mode).toBe(POCHTA_OPTION_PARCEL);
    expect(validated).toMatchObject({
      carrier_quote_amount: 350.5,
      carrier_quote_currency: "RUB",
      carrier_quote_provider: "pochta",
    });
  });

  it("stores the carrier quote for courier delivery", async () => {
    jest.spyOn(service.getPochtaClient(), "calculateTariff").mockResolvedValue({
      total_rate_rubles: 490,
      vat_rubles: 98,
      delivery_time_days_min: 1,
      delivery_time_days_max: 3,
      mail_type: "ONLINE_COURIER",
    });
    const context = { items: [{ id: "item_scarf", quantity: 1, product: { weight: 300, length: 25, width: 22, height: 12 } }] } as any;
    const validated = await service.validateFulfillmentData(
      { id: POCHTA_OPTION_COURIER },
      { postal_code: "190000", delivery_address: "Санкт-Петербург, Невский, 1" },
      context,
    );
    expect(validated.postal_code).toBe("190000");
    expect(validated.delivery_address).toBe("Санкт-Петербург, Невский, 1");
    expect(validated.delivery_mode).toBe(POCHTA_OPTION_COURIER);
    expect(validated).toMatchObject({
      carrier_quote_amount: 490,
      carrier_quote_currency: "RUB",
      carrier_quote_provider: "pochta",
    });
  });

  it("keeps a parcel free for the customer after the carrier tariff succeeds", async () => {
    const calculate = jest.spyOn(service.getPochtaClient(), "calculateTariff").mockResolvedValue({
      total_rate_rubles: 350.5,
      vat_rubles: 70,
      delivery_time_days_min: 2,
      delivery_time_days_max: 4,
      mail_type: "ONLINE_PARCEL",
    });
    const price = await service.calculatePrice(
      { id: POCHTA_OPTION_PARCEL },
      { postal_code: "101000", post_office_address: "Москва, Мясницкая, 26" },
      { items: [{ id: "item_coat", quantity: 2, variant: { weight: 500, length: 30, width: 20, height: 10 } }] },
    );
    expect(calculate).toHaveBeenCalledWith(expect.objectContaining({
      toIndex: "101000",
      weightGrams: 1000,
      lengthCm: 30,
      isCourier: false,
    }));
    expect(price.calculated_amount).toBe(0);
    expect(price.is_calculated_price_tax_inclusive).toBe(true);
  });

  it("keeps courier delivery free for the customer after the carrier tariff succeeds", async () => {
    const calculate = jest.spyOn(service.getPochtaClient(), "calculateTariff").mockResolvedValue({
      total_rate_rubles: 490,
      vat_rubles: 98,
      delivery_time_days_min: 1,
      delivery_time_days_max: 3,
      mail_type: "ONLINE_COURIER",
    });
    const price = await service.calculatePrice(
      { id: POCHTA_OPTION_COURIER },
      { postal_code: "190000", delivery_address: "Санкт-Петербург, Невский, 1" },
      { items: [{ id: "item_scarf", quantity: 1, product: { weight: 300, length: 25, width: 22, height: 12 } }] },
    );
    expect(calculate).toHaveBeenCalledWith(expect.objectContaining({ isCourier: true, weightGrams: 300 }));
    expect(price.calculated_amount).toBe(0);
  });

  it("rejects pricing before the carrier call when cart data is invalid", async () => {
    const calculate = jest.spyOn(service.getPochtaClient(), "calculateTariff");
    await expect(service.calculatePrice(
      { id: "pochta-return" },
      { postal_code: "101000", post_office_address: "Москва, Мясницкая, 26" },
      { items: [{ id: "item_coat", quantity: 1, variant: { weight: 500, length: 30, width: 20, height: 10 } }] },
    )).rejects.toThrow("option");
    await expect(service.calculatePrice(
      { id: POCHTA_OPTION_PARCEL },
      { postal_code: "101000", post_office_address: "Москва, Мясницкая, 26" },
      { items: [] },
    )).rejects.toThrow("cart items");
    expect(calculate).not.toHaveBeenCalled();
  });

  it("propagates a tariff failure instead of returning free shipping", async () => {
    jest.spyOn(service.getPochtaClient(), "calculateTariff").mockRejectedValue(new Error("Russian Post tariff unavailable"));
    await expect(service.calculatePrice(
      { id: POCHTA_OPTION_PARCEL },
      { postal_code: "101000", post_office_address: "Москва, Мясницкая, 26" },
      { items: [{ id: "item_coat", quantity: 1, variant: { weight: 500, length: 30, width: 20, height: 10 } }] },
    )).rejects.toThrow("Russian Post tariff unavailable");
  });

  it("creates an ONLINE_PARCEL backlog shipment from validated data and a Medusa shipping option", async () => {
    jest.spyOn(service.getPochtaClient(), "calculateTariff").mockResolvedValue({
      total_rate_rubles: 350,
      vat_rubles: 70,
      delivery_time_days_min: 2,
      delivery_time_days_max: 4,
      mail_type: "ONLINE_PARCEL",
    });
    const data = await service.validateFulfillmentData(
      { id: POCHTA_OPTION_PARCEL },
      { postal_code: "119571", post_office_address: "Ленинский, 156", delivery_mode: POCHTA_OPTION_COURIER },
      { items: [{ id: "item_coat", quantity: 2, variant: { weight: 500, length: 30, width: 20, height: 10 } }] } as unknown as Parameters<PochtaFulfillmentProviderService["validateFulfillmentData"]>[2],
    );
    const put = jest.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ result: { "result-ids": [{ barcode: "80088812345678", id: 101 }] } }),
    });
    global.fetch = put;
    const result = await service.createFulfillment(data, FULFILLMENT_ITEMS, ORDER, MEDUSA_SHIPPING_OPTION);
    expect(put).toHaveBeenCalledTimes(1);
    const [url, init] = put.mock.calls[0];
    expect(url).toBe("https://otpravka-api.pochta.ru/1.0/user/backlog");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body)).toEqual([expect.objectContaining({
      "mail-type": "ONLINE_PARCEL",
      "address-type-to": "POSTOFFICE",
      "order-num": "1001",
      "recipient-name": "Петр Петров",
      mass: 1300,
      dimension: { length: 30, width: 22, height: 12 },
    })]);
    expect(result.data.delivery_mode).toBe(POCHTA_OPTION_PARCEL);
    expect(result.labels).toHaveLength(1);
    expect(result.labels[0].tracking_number).toBe("80088812345678");
  });

  it("creates an ONLINE_COURIER backlog shipment from validated data and a Medusa shipping option", async () => {
    jest.spyOn(service.getPochtaClient(), "calculateTariff").mockResolvedValue({
      total_rate_rubles: 490,
      vat_rubles: 98,
      delivery_time_days_min: 1,
      delivery_time_days_max: 3,
      mail_type: "ONLINE_COURIER",
    });
    const data = await service.validateFulfillmentData(
      { id: POCHTA_OPTION_COURIER },
      { postal_code: "119571", delivery_address: "Москва, Ленинский, 156", delivery_mode: POCHTA_OPTION_PARCEL },
      { items: [{ id: "item_coat", quantity: 1, variant: { weight: 500, length: 30, width: 20, height: 10 } }] } as unknown as Parameters<PochtaFulfillmentProviderService["validateFulfillmentData"]>[2],
    );
    const put = jest.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ result: { "result-ids": [{ barcode: "80088812345679", id: 102 }] } }),
    });
    global.fetch = put;
    const result = await service.createFulfillment(data, FULFILLMENT_ITEMS, ORDER, MEDUSA_SHIPPING_OPTION);
    expect(put).toHaveBeenCalledTimes(1);
    const [url, init] = put.mock.calls[0];
    expect(url).toBe("https://otpravka-api.pochta.ru/1.0/user/backlog");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body)).toEqual([expect.objectContaining({
      "mail-type": "ONLINE_COURIER",
      "address-type-to": "MANUAL",
      "address-to": "Москва, Ленинский, 156",
      "index-to": "119571",
    })]);
    expect(result.data.delivery_mode).toBe(POCHTA_OPTION_COURIER);
    expect(result.labels[0].tracking_number).toBe("80088812345679");
  });

  it("uses variant physical fields before variant product and order item product fallbacks", async () => {
    const createOrder = jest.spyOn(service.getPochtaClient(), "createBacklogOrder").mockResolvedValue({
      barcode: "80088812345678",
      orderId: "102",
    });
    await service.createFulfillment(
      PARCEL_DATA,
      [{ line_item_id: "item_coat", quantity: 1 }],
      {
        ...ORDER,
        items: [{
          id: "item_coat",
          variant: {
            weight: 700,
            height: 9,
            product: { weight: 900, length: 36, height: 20 },
          },
          product: { weight: 1_000, length: 40, width: 26, height: 30 },
        }],
      },
      MEDUSA_SHIPPING_OPTION,
    );
    expect(createOrder).toHaveBeenCalledWith(expect.objectContaining({
      weightGrams: 700,
      lengthCm: 36,
      widthCm: 26,
      heightCm: 9,
    }));
  });

  it("blocks fulfillment when Russian Post rejects order creation", async () => {
    jest.spyOn(service.getPochtaClient(), "createBacklogOrder").mockRejectedValue(new Error("upstream failed"));
    await expect(service.createFulfillment(
      PARCEL_DATA,
      FULFILLMENT_ITEMS,
      ORDER,
      MEDUSA_SHIPPING_OPTION,
    )).rejects.toThrow("upstream failed");
  });

  it("rejects fulfillment before upstream creation when real order data is missing", async () => {
    const createOrder = jest.spyOn(service.getPochtaClient(), "createBacklogOrder");
    await expect(service.createFulfillment(
      PARCEL_DATA,
      FULFILLMENT_ITEMS,
      { id: "ord_without_recipient" },
      MEDUSA_SHIPPING_OPTION,
    )).rejects.toThrow("Invalid Russian Post fulfillment data: order");
    expect(createOrder).not.toHaveBeenCalled();
  });

  it.each([
    ["missing line ID", [{ quantity: 1 }], ORDER],
    ["null line ID", [{ line_item_id: null, quantity: 1 }], ORDER],
    ["unmatched line ID", [{ line_item_id: "item_missing", quantity: 1 }], ORDER],
    ["duplicate line ID", [...FULFILLMENT_ITEMS, ...FULFILLMENT_ITEMS], ORDER],
    ["missing physical field", FULFILLMENT_ITEMS, { ...ORDER, items: [{ id: "item_coat", variant: { weight: 500, length: 30, width: 20 } }] }],
    ["non-finite physical field", FULFILLMENT_ITEMS, { ...ORDER, items: [{ id: "item_coat", variant: { weight: Number.POSITIVE_INFINITY, length: 30, width: 20, height: 10 } }] }],
    ["non-positive physical field", FULFILLMENT_ITEMS, { ...ORDER, items: [{ id: "item_coat", variant: { weight: 0, length: 30, width: 20, height: 10 } }] }],
    ["aggregate package limit", [{ line_item_id: "item_coat", quantity: 41 }], ORDER],
  ])("rejects %s before upstream creation", async (_caseName, items, order) => {
    const createOrder = jest.spyOn(service.getPochtaClient(), "createBacklogOrder");
    await expect(service.createFulfillment(
      PARCEL_DATA,
      items,
      order,
      MEDUSA_SHIPPING_OPTION,
    )).rejects.toThrow("Invalid Russian Post fulfillment data");
    expect(createOrder).not.toHaveBeenCalled();
  });

  it.each([
    ["missing mode", { postal_code: "119571", post_office_address: "Ленинский, 156" }, "delivery mode"],
    ["invalid mode", { ...PARCEL_DATA, delivery_mode: "pochta-express" }, "delivery mode"],
    ["parcel with only a courier address", { delivery_mode: POCHTA_OPTION_PARCEL, postal_code: "119571", delivery_address: "Ленинский, 156" }, "post office address"],
    ["courier with only a post office address", { delivery_mode: POCHTA_OPTION_COURIER, postal_code: "119571", post_office_address: "Ленинский, 156" }, "delivery address"],
    ["courier with a mismatched postal index", { ...COURIER_DATA, postal_code: "101000" }, "postal index mismatch"],
  ])("rejects %s before making a backlog request", async (_caseName, data, reason) => {
    const createOrder = jest.spyOn(service.getPochtaClient(), "createBacklogOrder");
    await expect(service.createFulfillment(data, FULFILLMENT_ITEMS, ORDER, MEDUSA_SHIPPING_OPTION))
      .rejects.toThrow(`Invalid Russian Post fulfillment data: ${reason}`);
    expect(createOrder).not.toHaveBeenCalled();
  });
});
