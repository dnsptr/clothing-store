import { BigNumber } from "@medusajs/framework/utils";
import type { ValidateFulfillmentDataContext } from "@medusajs/types";
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
  buildCdekCartPackages,
  UnsupportedCdekCancellationError,
  UnsupportedCdekReturnError,
} from "../fulfillment-data";

const TEST_OPTIONS: CdekProviderOptions = {
  clientId: "mock-id",
  clientSecret: "mock-secret",
  apiBaseUrl: "https://api.edu.cdek.ru/v2",
  fromCityCode: 44,
  pvzPriceRub: 350,
  courierPriceRub: 490,
};

const ORIGIN = {
  carrier: "cdek" as const, id: "MSK65", name: "Пункт отправки Москва",
  address: "ул. Динамовская, 1А", city_code: 44,
};
const ALTERNATE = {
  carrier: "cdek" as const, id: "SPB10", name: "Пункт отправки Петербург",
  address: "Невский проспект, 10", city_code: 137,
};
const HANDOFF_POINTS = [ORIGIN, ALTERNATE].map(({ carrier: _carrier, ...point }) => ({ ...point, active: true }));
function sourceLocation(points = HANDOFF_POINTS, defaultId = ORIGIN.id) {
  return {
    id: "sl_source",
    address: { metadata: { carrier_handoff: { cdek: { default_id: defaultId, points } } } },
  };
}

const PARCEL = { weight: 700, length: 30, width: 25, height: 10 };
const ITEM = { id: "item_1", variant_id: "variant_shirt", title: "Рубашка хлопковая, размер M", unit_price: 2500 };
const SINGLE_PACKAGES = buildCdekCartPackages([{ ...ITEM, quantity: 1, variant: PARCEL }]);

function fulfillmentContext(items: unknown[], location: unknown = sourceLocation()) {
  // Only fields consumed by this provider are present in unit fixtures.
  return { items, from_location: location } as unknown as ValidateFulfillmentDataContext;
}
const POINT = {
  code: "MSK65", name: "ПВЗ Динамовская", type: "PVZ" as const,
  location: { address: "ул. Динамовская, 1А", city_code: 44, city: "Москва" },
  work_time: "10:00-20:00", phones: [],
};
describe("CdekFulfillmentProviderService", () => {
  let service: CdekFulfillmentProviderService;

  beforeEach(() => {
    service = new CdekFulfillmentProviderService({}, TEST_OPTIONS);
    jest.spyOn(service.getCdekClient(), "getDeliveryPoints").mockResolvedValue([POINT]);
    jest.spyOn(service.getCdekClient(), "getReceptionPoints").mockResolvedValue([{ ...POINT, is_reception: true }]);
    jest.spyOn(service.getCdekClient(), "calculateTariff").mockResolvedValue({
      tariff_code: 136, tariff_name: "PVZ", delivery_sum: 450, period_min: 1, period_max: 3,
    });
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

    await expect(service.validateFulfillmentData({ id: "unknown_option" }, {}, fulfillmentContext([]))).rejects.toThrow(CdekFulfillmentDataError);
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
    const context = fulfillmentContext([{ ...ITEM, quantity: 1, variant: { weight: 500, length: 20, width: 10, height: 5 } }]);
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
      fulfillmentContext([{ ...ITEM, quantity: 1, variant: PARCEL }]),
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
      fulfillmentContext([{ ...ITEM, quantity: 1, variant: { weight: 500, length: 20, width: 10, height: 5 } }]),
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
    const context = fulfillmentContext([]);
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
      fulfillmentContext([]),
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

  it("charges the approved PVZ price after independently checking the carrier tariff", async () => {
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
      { from_location: sourceLocation(), items: [{ ...ITEM, quantity: 1, variant: { weight: 500, length: 20, width: 10, height: 5 } }] },
    );
    expect(calculateTariff).toHaveBeenCalledWith(expect.objectContaining({
      tariffCode: 136,
      toCityCode: 44,
      packages: [{ weight: 500, length: 20, width: 10, height: 5 }],
    }));
    expect(price.calculated_amount).toBe(350);
    expect(price.is_calculated_price_tax_inclusive).toBe(true);
  });

  it("charges the approved courier price after independently checking the carrier tariff", async () => {
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
      { from_location: sourceLocation(), items: [{ ...ITEM, quantity: 1, product: { weight: 700, length: 30, width: 25, height: 10 } }] },
    );
    expect(calculateTariff).toHaveBeenCalledWith(expect.objectContaining({ tariffCode: 137, toCityCode: 137 }));
    expect(price.calculated_amount).toBe(490);
  });

  it("quotes each separately packed unit and charges the customer once", async () => {
    const calculateTariff = jest.spyOn(service.getCdekClient(), "calculateTariff").mockResolvedValue({
      tariff_code: 136, tariff_name: "PVZ", delivery_sum: 950, period_min: 1, period_max: 3,
    });
    const price = await service.calculatePrice(
      { id: CDEK_OPTION_PVZ }, { city_code: 44 },
      { from_location: sourceLocation(), items: [{ ...ITEM, quantity: 2, variant: PARCEL }] },
    );
    expect(calculateTariff).toHaveBeenCalledWith(expect.objectContaining({ packages: [PARCEL, PARCEL] }));
    expect(price.calculated_amount).toBe(350);
  });

  it("rejects CDEK pricing before the carrier call when cart data is invalid", async () => {
    const calculateTariff = jest.spyOn(service.getCdekClient(), "calculateTariff");
    await expect(service.calculatePrice(
      { id: CDEK_OPTION_PVZ },
      {},
      { from_location: sourceLocation(), items: [{ ...ITEM, quantity: 1, variant: { weight: 500, length: 20, width: 10, height: 5 } }] },
    )).rejects.toThrow(CdekFulfillmentDataError);
    await expect(service.calculatePrice(
      { id: "cdek-return" },
      { city_code: 44 },
      { from_location: sourceLocation(), items: [{ ...ITEM, quantity: 1, variant: { weight: 500, length: 20, width: 10, height: 5 } }] },
    )).rejects.toThrow("option");
    expect(calculateTariff).not.toHaveBeenCalled();
  });

  it("propagates a CDEK tariff failure instead of returning free shipping", async () => {
    jest.spyOn(service.getCdekClient(), "calculateTariff").mockRejectedValue(new Error("CDEK tariff unavailable"));
    await expect(service.calculatePrice(
      { id: CDEK_OPTION_PVZ },
      { city_code: 44 },
      { from_location: sourceLocation(), items: [{ ...ITEM, quantity: 1, variant: { weight: 500, length: 20, width: 10, height: 5 } }] },
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
        handoff_origin: ORIGIN,
        city_code: 44,
        cdek_pvz_code: "MSK65",
        cdek_pvz_address: "ул. Динамовская, 1А",
        validated_packages: SINGLE_PACKAGES,
      },
      [{ line_item_id: "item_1", quantity: 1 }],
      {
        id: "ord_123",
        currency_code: "rub",
        email: "buyer@example.com",
        shipping_address: { first_name: "Иван", last_name: "Иванов", phone: "+79991234567" },
        items: [{ ...ITEM, quantity: 1, variant: PARCEL }],
      },
      { shipping_option_id: "so_cdek_pvz", location_id: "sl_source" },
      { handoff_location: sourceLocation() },
    );

    expect(createOrder).toHaveBeenCalledWith(expect.objectContaining({
      tariffCode: 136,
      deliveryPoint: "MSK65",
      toAddress: undefined,
    }));
    expect(result.data.cdek_uuid).toBe("cdek-pvz-uuid");
    expect(result.labels).toEqual([]);
  });

  it("creates a courier order with destination city code and address", async () => {
    const createOrder = jest.spyOn(service.getCdekClient(), "createOrder").mockResolvedValue({
      entity: { uuid: "cdek-courier-uuid" },
      requests: [],
    });

    await service.createFulfillment(
      {
        delivery_mode: CDEK_OPTION_COURIER,
        handoff_origin: ORIGIN,
        city_code: 137,
        delivery_address: "Невский проспект, 1, кв. 2",
        validated_packages: SINGLE_PACKAGES,
      },
      [{ line_item_id: "item_1", quantity: 1 }],
      {
        id: "ord_456",
        currency_code: "rub",
        shipping_address: { first_name: "Анна", phone: "+79997654321" },
        items: [{ ...ITEM, quantity: 1, variant: PARCEL }],
      },
      { shipping_option_id: "so_cdek_courier", location_id: "sl_source" },
      { handoff_location: sourceLocation() },
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
        handoff_origin: ORIGIN,
        city_code: 44,
        cdek_pvz_code: "MSK65",
        cdek_pvz_address: "ул. Динамовская, 1А",
        validated_packages: SINGLE_PACKAGES,
      },
      [{ line_item_id: "item_1", quantity: 1 }],
      { id: "ord_789", currency_code: "rub", shipping_address: { first_name: "Иван", phone: "+79991234567" }, items: [{ ...ITEM, quantity: 1, variant: PARCEL }] },
      { shipping_option_id: "so_cdek_pvz", location_id: "sl_source" },
      { handoff_location: sourceLocation() },
    )).rejects.toThrow("CDEK unavailable");
  });

  it("rejects shipment creation without a real order identity", async () => {
    await expect(service.createFulfillment(
      {
        delivery_mode: CDEK_OPTION_PVZ,
        handoff_origin: ORIGIN,
        city_code: 44,
        cdek_pvz_code: "MSK65",
      },
      [],
      { shipping_address: { first_name: "Иван", phone: "+79991234567" } },
      { shipping_option_id: "so_cdek_pvz", location_id: "sl_source" },
      { handoff_location: sourceLocation() },
    )).rejects.toThrow("order identity");
  });

  it("books the same three measured places quoted for two lines in any order", async () => {
    const lines = [
      { ...ITEM, quantity: 2, variant: { weight: 500, length: 20, width: 10, height: 5 } },
      { ...ITEM, id: "item_2", variant_id: "variant_coat", title: "Пальто шерстяное, размер L", unit_price: 8000, quantity: 1, variant: PARCEL },
    ];
    const calculateTariff = jest.spyOn(service.getCdekClient(), "calculateTariff").mockResolvedValue({
      tariff_code: 136, tariff_name: "PVZ", delivery_sum: 1100, period_min: 1, period_max: 3,
    });
    const createOrder = jest.spyOn(service.getCdekClient(), "createOrder").mockResolvedValue({
      entity: { uuid: "cdek-multiple" }, requests: [],
    });
    const data = await service.validateFulfillmentData(
      { id: CDEK_OPTION_PVZ }, { city_code: 44, cdek_pvz_code: POINT.code }, fulfillmentContext(lines),
    );
    expect(createOrder).not.toHaveBeenCalled();
    const reorderedLines = [...lines].reverse().map((line) => ({ ...line, id: `order_${line.id}` }));
    const quotedPackages = buildCdekCartPackages(lines);
    const result = await service.createFulfillment({ ...data, validated_packages: [...quotedPackages].reverse() },
      reorderedLines.map((line) => ({ line_item_id: line.id, quantity: line.quantity })),
      { id: "order_three", currency_code: "rub", shipping_address: { first_name: "Иван", phone: "+79991234567" }, items: reorderedLines }, { location_id: "sl_source" },
      { handoff_location: sourceLocation() },
    );
    const booked = createOrder.mock.calls[0][0].packages;
    expect(booked).toHaveLength(3);
    expect(booked.map(({ weight, length, width, height }) => ({ weight, length, width, height })))
      .toEqual(calculateTariff.mock.calls[0][0].packages);
    expect(booked.map((place) => place.number).sort()).toEqual(
      quotedPackages.map((place) => place.number).sort(),
    );
    expect(Object.keys(Object.fromEntries(booked.map((place) => [place.number, true])))).toHaveLength(3);
    expect(booked).toEqual(expect.arrayContaining([
      expect.objectContaining({ items: [{ name: ITEM.title, ware_key: ITEM.variant_id, cost: ITEM.unit_price, weight: 500, amount: 1, payment: { value: 0 } }] }),
      expect.objectContaining({ items: [{ name: lines[1].title, ware_key: "variant_coat", cost: 8000, weight: 700, amount: 1, payment: { value: 0 } }] }),
    ]));
    expect(result.data.validated_packages).toEqual(data.validated_packages);
    expect(result.labels).toEqual([]);
    expect(data.carrier_quote_amount).toBe(1100);
  });

  it("canonicalizes equivalent split lines but rejects a different variant of the same size", () => {
    const original = buildCdekCartPackages([{ ...ITEM, quantity: 3, variant: PARCEL }]);
    expect(buildCdekCartPackages([
      { ...ITEM, id: "other_2", quantity: 1, variant: PARCEL },
      { ...ITEM, id: "other_1", quantity: 2, variant: PARCEL },
    ])).toEqual(original);
    expect(buildCdekCartPackages([{ ...ITEM, variant_id: "replacement", quantity: 3, variant: PARCEL }]))
      .not.toEqual(original);
  });

  it("normalizes native monetary values without accepting missing or fabricated prices", () => {
    const expected = buildCdekCartPackages([{ ...ITEM, quantity: 1, variant: PARCEL }]);
    for (const unitPrice of [String(ITEM.unit_price), new BigNumber(ITEM.unit_price)]) {
      expect(buildCdekCartPackages([{ ...ITEM, unit_price: unitPrice, quantity: 1, variant: PARCEL }])).toEqual(expected);
    }
    for (const unitPrice of [undefined, null, "", " ", false, Number.POSITIVE_INFINITY, -1]) {
      expect(() => buildCdekCartPackages([{ ...ITEM, unit_price: unitPrice, quantity: 1, variant: PARCEL }]))
        .toThrow(CdekFulfillmentDataError);
    }
  });

  it.each(["last dimensions", "same sized replacement", "unit price", "partial quantity", "missing line", "duplicate fulfillment", "unmatched fulfillment", "duplicate order"])(
    "rejects changed composition before any network call: %s", async (change) => {
      const lines = [
        { ...ITEM, quantity: 2, variant: PARCEL },
        { ...ITEM, id: "item_2", variant_id: "variant_coat", quantity: 1, variant: { ...PARCEL } },
      ];
      const saved = buildCdekCartPackages(lines);
      let fulfillmentItems = lines.map((line) => ({ line_item_id: line.id, quantity: line.quantity }));
      if (change === "last dimensions") lines[1].variant.height += 1;
      if (change === "same sized replacement") lines[1].variant_id = "variant_replaced";
      if (change === "unit price") lines[1].unit_price += 1;
      if (change === "partial quantity") fulfillmentItems[0].quantity = 1;
      if (change === "missing line") fulfillmentItems = fulfillmentItems.slice(0, 1);
      if (change === "duplicate fulfillment") fulfillmentItems.push(fulfillmentItems[0]);
      if (change === "unmatched fulfillment") fulfillmentItems[1].line_item_id = "missing";
      if (change === "duplicate order") lines[1].id = lines[0].id;
      const points = jest.spyOn(service.getCdekClient(), "getDeliveryPoints");
      const createOrder = jest.spyOn(service.getCdekClient(), "createOrder");
      await expect(service.createFulfillment({
        handoff_origin: ORIGIN, delivery_mode: CDEK_OPTION_PVZ, city_code: 44, cdek_pvz_code: POINT.code, validated_packages: saved,
      }, fulfillmentItems, {
        id: "ord_changed", currency_code: "rub", shipping_address: { first_name: "Иван", phone: "+79991234567" }, items: lines,
      }, { location_id: "sl_source" }, { handoff_location: sourceLocation() })).rejects.toThrow(CdekFulfillmentDataError);
      expect(points).not.toHaveBeenCalled();
      expect(createOrder).not.toHaveBeenCalled();
    },
  );

  it.each([
    { items: [{ ...ITEM, quantity: 101, variant: PARCEL }] },
    { items: [{ ...ITEM, quantity: 60, variant: PARCEL }, { ...ITEM, id: "item_2", quantity: 41, variant: PARCEL }] },
    { items: [{ ...ITEM, quantity: 1, variant: PARCEL }, { ...ITEM, quantity: 1, variant: PARCEL }] },
    { items: [{ ...ITEM, quantity: 1, variant: { ...PARCEL, weight: 0 } }] },
    { items: [{ ...ITEM, quantity: 1, variant: { ...PARCEL, height: 10.5 } }] },
    { items: [{ ...ITEM, quantity: 1, variant: {} }] },
    { items: [{ ...ITEM, variant_id: undefined, quantity: 1, variant: PARCEL }] },
    { items: [{ ...ITEM, unit_price: undefined, quantity: 1, variant: PARCEL }] },
  ])("rejects invalid quote manifests before network access: %j", async ({ items }) => {
    const calculate = jest.spyOn(service.getCdekClient(), "calculateTariff");
    const points = jest.spyOn(service.getCdekClient(), "getDeliveryPoints");
    const createOrder = jest.spyOn(service.getCdekClient(), "createOrder");
    await expect(service.calculatePrice({ id: CDEK_OPTION_PVZ }, { city_code: 44 }, { items, from_location: sourceLocation() }))
      .rejects.toThrow(CdekFulfillmentDataError);
    await expect(service.validateFulfillmentData({ id: CDEK_OPTION_PVZ }, { city_code: 44, cdek_pvz_code: POINT.code }, fulfillmentContext(items)))
      .rejects.toThrow(CdekFulfillmentDataError);
    await expect(service.createFulfillment({
      handoff_origin: ORIGIN, delivery_mode: CDEK_OPTION_PVZ, city_code: 44, cdek_pvz_code: POINT.code, validated_packages: [],
    }, items.map((item) => ({ line_item_id: item.id, quantity: item.quantity })), {
      id: "ord_invalid", currency_code: "rub", shipping_address: { first_name: "Иван", phone: "+79991234567" }, items,
    }, { location_id: "sl_source" }, { handoff_location: sourceLocation() })).rejects.toThrow(CdekFulfillmentDataError);
    expect(calculate).not.toHaveBeenCalled();
    expect(points).not.toHaveBeenCalled();
    expect(createOrder).not.toHaveBeenCalled();
  });

  it("accepts exactly 100 measured places", async () => {
    jest.spyOn(service.getCdekClient(), "calculateTariff").mockResolvedValue({
      tariff_code: 136, tariff_name: "PVZ", delivery_sum: 10000, period_min: 1, period_max: 3,
    });
    const validated = await service.validateFulfillmentData({ id: CDEK_OPTION_COURIER },
      { city_code: 44, delivery_address: "Москва, улица Примерная, 1" },
      fulfillmentContext([{ ...ITEM, quantity: 100, variant: PARCEL }]));
    expect(validated.validated_packages).toHaveLength(100);
  });

  it("rejects absent or tampered persisted packages before carrier mutation", async () => {
    const createOrder = jest.spyOn(service.getCdekClient(), "createOrder");
    for (const saved of [undefined, [], SINGLE_PACKAGES.map((place) => ({ ...place, weight: 500 }))]) {
      await expect(service.createFulfillment({
        handoff_origin: ORIGIN, delivery_mode: CDEK_OPTION_PVZ, city_code: 44, cdek_pvz_code: POINT.code, validated_packages: saved,
      }, [{ line_item_id: ITEM.id, quantity: 1 }], {
        id: "ord_stale", currency_code: "rub", shipping_address: { first_name: "Иван", phone: "+79991234567" },
        items: [{ ...ITEM, quantity: 1, variant: PARCEL }],
      }, { location_id: "sl_source" }, { handoff_location: sourceLocation() })).rejects.toThrow(CdekFulfillmentDataError);
    }
    expect(createOrder).not.toHaveBeenCalled();
  });

  it.each(["item title", "currency"])("requires real booking data: %s", async (missing) => {
    const createOrder = jest.spyOn(service.getCdekClient(), "createOrder");
    const points = jest.spyOn(service.getCdekClient(), "getDeliveryPoints");
    await expect(service.createFulfillment({
      handoff_origin: ORIGIN, delivery_mode: CDEK_OPTION_PVZ, city_code: 44, cdek_pvz_code: POINT.code, validated_packages: SINGLE_PACKAGES,
    }, [{ line_item_id: ITEM.id, quantity: 1 }], {
      id: "ord_missing", currency_code: missing === "currency" ? "usd" : "rub",
      shipping_address: { first_name: "Иван", phone: "+79991234567" },
      items: [{ ...ITEM, title: missing === "item title" ? "" : ITEM.title, quantity: 1, variant: PARCEL }],
    }, { location_id: "sl_source" }, { handoff_location: sourceLocation() })).rejects.toThrow(CdekFulfillmentDataError);
    expect(points).not.toHaveBeenCalled();
    expect(createOrder).not.toHaveBeenCalled();
  });

  it.each([undefined, {}, { metadata: { carrier_handoff: { cdek: { default_id: ORIGIN.id, points: HANDOFF_POINTS } } } }])(
    "blocks paid preparation without a source address registry: %j", async (location) => {
      const points = jest.spyOn(service.getCdekClient(), "getReceptionPoints");
      const calculate = jest.spyOn(service.getCdekClient(), "calculateTariff");
      const context = fulfillmentContext([{ ...ITEM, quantity: 1, variant: PARCEL }], location ?? null);
      for (const optionId of [CDEK_OPTION_PVZ, CDEK_OPTION_COURIER]) {
        await expect(service.validateFulfillmentData({ id: optionId }, {
          city_code: 44, cdek_pvz_code: POINT.code, delivery_address: "Москва, улица Примерная, 1",
        }, context)).rejects.toThrow();
        await expect(service.calculatePrice({ id: optionId }, { city_code: 44 }, {
          from_location: location, items: [{ ...ITEM, quantity: 1, variant: PARCEL }],
        })).rejects.toThrow();
      }
      expect(points).not.toHaveBeenCalled();
      expect(calculate).not.toHaveBeenCalled();
      await expect(service.validateFulfillmentData({ id: CDEK_OPTION_PICKUP }, {
        pickup_store_id: "store_nebo",
      }, context)).resolves.toMatchObject({ delivery_mode: CDEK_OPTION_PICKUP });
    },
  );

  it("rechecks PVZ availability before creating a carrier order", async () => {
    jest.spyOn(service.getCdekClient(), "getDeliveryPoints").mockResolvedValue([]);
    const createOrder = jest.spyOn(service.getCdekClient(), "createOrder");
    await expect(service.createFulfillment(
      { handoff_origin: ORIGIN, delivery_mode: CDEK_OPTION_PVZ, city_code: 44, cdek_pvz_code: POINT.code, validated_packages: SINGLE_PACKAGES },
      [{ line_item_id: "item_1", quantity: 1 }],
      { id: "ord_closed_pvz", currency_code: "rub", shipping_address: { first_name: "Иван", phone: "+79991234567" },
        items: [{ ...ITEM, quantity: 1, variant: PARCEL }] }, { location_id: "sl_source" },
      { handoff_location: sourceLocation() },
    )).rejects.toThrow("PVZ is no longer available");
    expect(createOrder).not.toHaveBeenCalled();
  });

  it("ignores a forged checkout origin and registry and saves the server default", async () => {
    const calculate = jest.spyOn(service.getCdekClient(), "calculateTariff");
    const validated = await service.validateFulfillmentData({ id: CDEK_OPTION_COURIER }, {
      city_code: 44, delivery_address: "Москва, Тверская, 1",
      handoff_origin: ALTERNATE, dispatch_point_id: ALTERNATE.id,
      carrier_handoff: { cdek: { default_id: ALTERNATE.id, points: HANDOFF_POINTS } },
    }, fulfillmentContext([{ ...ITEM, quantity: 1, variant: PARCEL }]));
    expect(validated.handoff_origin).toEqual(ORIGIN);
    expect(calculate).toHaveBeenCalledWith(expect.objectContaining({ fromCityCode: ORIGIN.city_code }));
  });

  it("prices the persisted allowed source instead of a changed default", async () => {
    const calculate = jest.spyOn(service.getCdekClient(), "calculateTariff");
    const result = await service.calculatePrice({ id: CDEK_OPTION_PVZ }, {
      city_code: 44, handoff_origin: ORIGIN,
    }, {
      from_location: sourceLocation(HANDOFF_POINTS, ALTERNATE.id),
      items: [{ ...ITEM, quantity: 2, variant: PARCEL }],
    });
    expect(calculate).toHaveBeenCalledWith(expect.objectContaining({
      fromCityCode: ORIGIN.city_code, packages: [PARCEL, PARCEL],
    }));
    expect(result.calculated_amount).toBe(TEST_OPTIONS.pvzPriceRub);
  });

  it("keeps the checkout source when location default and diagnostic city change", async () => {
    service = new CdekFulfillmentProviderService({}, { ...TEST_OPTIONS, fromCityCode: 999 });
    jest.spyOn(service.getCdekClient(), "getReceptionPoints").mockResolvedValue([{ ...POINT, is_reception: true }]);
    const quote = jest.spyOn(service.getCdekClient(), "calculateTariff").mockResolvedValue({
      tariff_code: 137, tariff_name: "Courier", delivery_sum: 611, period_min: 1, period_max: 3,
    });
    const createOrder = jest.spyOn(service.getCdekClient(), "createOrder").mockResolvedValue({
      entity: { uuid: "saved-origin" }, requests: [],
    });
    const result = await service.createFulfillment({
      delivery_mode: CDEK_OPTION_COURIER, handoff_origin: ORIGIN,
      city_code: 44, delivery_address: "Москва, Тверская, 1",
      validated_packages: SINGLE_PACKAGES, carrier_quote_amount: 1,
    }, [{ line_item_id: ITEM.id, quantity: 1 }], {
      id: "order_saved", currency_code: "rub",
      shipping_address: { first_name: "Иван", phone: "+79991234567" },
      items: [{ ...ITEM, quantity: 1, variant: PARCEL }],
    }, { location_id: "sl_source" }, { handoff_location: sourceLocation(HANDOFF_POINTS, ALTERNATE.id) });
    expect(quote).toHaveBeenCalledWith(expect.objectContaining({ fromCityCode: ORIGIN.city_code }));
    expect(createOrder).toHaveBeenCalledWith(expect.objectContaining({ shipmentPoint: ORIGIN.id }));
    expect(result.data).toMatchObject({ handoff_origin: ORIGIN, carrier_quote_amount: 611, carrier_quote_currency: "RUB" });
  });

  it("books an employee-selected allowed alternate and records its requoted expense", async () => {
    const reception = jest.spyOn(service.getCdekClient(), "getReceptionPoints").mockResolvedValue([{
      ...POINT, code: ALTERNATE.id, is_reception: true,
      location: { ...POINT.location, city_code: ALTERNATE.city_code },
    }]);
    const quote = jest.spyOn(service.getCdekClient(), "calculateTariff").mockResolvedValue({
      tariff_code: 137, tariff_name: "Courier", delivery_sum: 829, period_min: 1, period_max: 3,
    });
    const createOrder = jest.spyOn(service.getCdekClient(), "createOrder").mockResolvedValue({
      entity: { uuid: "alternate-origin" }, requests: [],
    });
    const result = await service.createFulfillment({
      delivery_mode: CDEK_OPTION_COURIER, handoff_origin: ORIGIN,
      city_code: 44, delivery_address: "Москва, Тверская, 1",
      validated_packages: SINGLE_PACKAGES, carrier_quote_amount: 1,
    }, [{ line_item_id: ITEM.id, quantity: 1 }], {
      id: "order_alternate", currency_code: "rub",
      shipping_address: { first_name: "Иван", phone: "+79991234567" },
      items: [{ ...ITEM, quantity: 1, variant: PARCEL }],
    }, { location_id: "sl_source" }, { handoff_location: sourceLocation(), dispatch_point_id: ALTERNATE.id });
    expect(reception).toHaveBeenCalledWith(ALTERNATE.city_code, ALTERNATE.id);
    expect(quote).toHaveBeenCalledWith(expect.objectContaining({ fromCityCode: ALTERNATE.city_code }));
    expect(createOrder).toHaveBeenCalledWith(expect.objectContaining({ shipmentPoint: ALTERNATE.id }));
    expect(result.data).toMatchObject({
      handoff_origin: ALTERNATE, carrier_quote_amount: 829,
      carrier_quote_currency: "RUB", carrier_quote_provider: "cdek",
    });
  });

  it.each([
    { name: "missing saved origin", origin: undefined, location: sourceLocation() },
    { name: "missing authoritative source", origin: ORIGIN, location: undefined },
    { name: "mismatched authoritative source ID", origin: ORIGIN, location: { ...sourceLocation(), id: "sl_other" } },
    { name: "different carrier", origin: { ...ORIGIN, carrier: "yandex" }, location: sourceLocation() },
    { name: "different stock source", origin: ORIGIN, location: sourceLocation(HANDOFF_POINTS.slice(1), ALTERNATE.id) },
    { name: "deleted saved point", origin: ORIGIN, location: sourceLocation([], ALTERNATE.id) },
    { name: "inactive saved point", origin: ORIGIN, location: sourceLocation(HANDOFF_POINTS.map((p) => ({ ...p, active: p.id !== ORIGIN.id })), ALTERNATE.id) },
  ])("rejects $name before carrier calls", async ({ origin, location }) => {
    const reception = jest.spyOn(service.getCdekClient(), "getReceptionPoints");
    const quote = jest.spyOn(service.getCdekClient(), "calculateTariff");
    const createOrder = jest.spyOn(service.getCdekClient(), "createOrder");
    await expect(service.createFulfillment({
      delivery_mode: CDEK_OPTION_COURIER, handoff_origin: origin,
      city_code: 44, delivery_address: "Москва, Тверская, 1", validated_packages: SINGLE_PACKAGES,
    }, [{ line_item_id: ITEM.id, quantity: 1 }], {
      id: "order_invalid_origin", currency_code: "rub",
      shipping_address: { first_name: "Иван", phone: "+79991234567" },
      items: [{ ...ITEM, quantity: 1, variant: PARCEL }],
    }, { location_id: "sl_source" }, { handoff_location: location })).rejects.toThrow();
    expect(reception).not.toHaveBeenCalled();
    expect(quote).not.toHaveBeenCalled();
    expect(createOrder).not.toHaveBeenCalled();
  });

  it.each([
    { points: [] },
    { points: [{ ...POINT, is_reception: false }] },
    { points: [{ ...POINT, is_reception: true, type: "POSTAMAT" as const }] },
    { points: [{ ...POINT, is_reception: true, location: { ...POINT.location, city_code: 137 } }] },
    { points: [{ ...POINT, is_reception: true, code: "OTHER" }] },
  ])("rejects an unavailable or mismatched reception point before booking: %j", async ({ points }) => {
    jest.spyOn(service.getCdekClient(), "getReceptionPoints").mockResolvedValue(points);
    const quote = jest.spyOn(service.getCdekClient(), "calculateTariff");
    const createOrder = jest.spyOn(service.getCdekClient(), "createOrder");
    await expect(service.createFulfillment({
      delivery_mode: CDEK_OPTION_COURIER, handoff_origin: ORIGIN,
      city_code: 44, delivery_address: "Москва, Тверская, 1", validated_packages: SINGLE_PACKAGES,
    }, [{ line_item_id: ITEM.id, quantity: 1 }], {
      id: "order_unavailable", currency_code: "rub",
      shipping_address: { first_name: "Иван", phone: "+79991234567" },
      items: [{ ...ITEM, quantity: 1, variant: PARCEL }],
    }, { location_id: "sl_source" }, { handoff_location: sourceLocation() })).rejects.toThrow("не принимает");
    expect(quote).not.toHaveBeenCalled();
    expect(createOrder).not.toHaveBeenCalled();
  });

  it("rejects unsupported cancellation and returns", async () => {
    await expect(service.cancelFulfillment({})).rejects.toThrow(UnsupportedCdekCancellationError);
    await expect(service.createReturnFulfillment()).rejects.toThrow(UnsupportedCdekReturnError);
  });
});
