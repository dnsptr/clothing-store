import OwnCourierFulfillmentProviderService, { UnsupportedOwnCourierCancellationError } from "../service";
import { parseOwnCourierEnvironment } from "../config";
import { ownCourierEligibility } from "../eligibility";
import { OWN_COURIER_OPTION } from "../provider-id";

const address = {
  country_code: "ru",
  city: "Москва",
  address_1: "ул Сухонская, д 11",
  address_2: "кв 89",
};
const inside = {
  result: "г Москва, ул Сухонская, д 11, кв 89",
  beltway_hit: "IN_MKAD",
  country_iso_code: "RU",
  region_iso_code: "RU-MOW",
  house: "11",
  qc: 0,
  qc_geo: 0,
  unparsed_parts: null,
};
const options = { token: "test-token", secret: "test-secret" };
const option = { id: OWN_COURIER_OPTION };

beforeEach(() => {
  jest.restoreAllMocks();
});

function stubClean(body: unknown, status = 200) {
  const request = jest.fn().mockResolvedValue({ ok: status === 200, status, json: async () => body });
  global.fetch = request;
  return request;
}

describe("own courier eligibility", () => {
  it("enables seeding only when both credentials are nonempty", () => {
    expect(parseOwnCourierEnvironment({})).toEqual({ enabled: false });
    expect(parseOwnCourierEnvironment({ DADATA_API_KEY: "key" })).toEqual({ enabled: false });
    expect(parseOwnCourierEnvironment({ DADATA_API_KEY: " ", DADATA_SECRET_KEY: "secret" })).toEqual({ enabled: false });
    expect(parseOwnCourierEnvironment({ DADATA_API_KEY: "key", DADATA_SECRET_KEY: "secret" }).enabled).toBe(true);
  });

  it("verifies the full cart address with DaData and disregards client assertions", async () => {
    const request = stubClean([inside]);
    const result = await ownCourierEligibility({ ...address, city: "Внутри МКАД" }, options);
    expect(result).toEqual({ eligible: true, normalizedAddress: inside.result });
    expect(request).toHaveBeenCalledWith("https://cleaner.dadata.ru/api/v1/clean/address", expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({ Authorization: "Token test-token", "X-Secret": "test-secret" }),
      body: JSON.stringify(["Россия, Внутри МКАД, ул Сухонская, д 11, кв 89"]),
      signal: expect.any(AbortSignal),
    }));
  });

  it.each([
    ["outside", { ...inside, beltway_hit: "OUT_MKAD" }],
    ["boundary unknown", { ...inside, beltway_hit: null }],
    ["other region", { ...inside, region_iso_code: "RU-MOS" }],
    ["no house", { ...inside, house: null }],
    ["ambiguous", { ...inside, qc: 3 }],
    ["imprecise", { ...inside, qc_geo: 1 }],
    ["unparsed", { ...inside, unparsed_parts: "ещё один адрес" }],
  ])("rejects %s response", async (_case, response) => {
    stubClean([response]);
    expect(await ownCourierEligibility(address, options)).toEqual({ eligible: false });
  });

  it.each([401, 403, 429, 500, 503])("fails closed for HTTP %s", async (status) => {
    stubClean({}, status);
    expect(await ownCourierEligibility(address, options)).toEqual({ eligible: false });
  });

  it("fails closed for malformed JSON, timeout and incomplete cart address", async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => { throw new SyntaxError("invalid JSON"); } });
    expect(await ownCourierEligibility(address, options)).toEqual({ eligible: false });
    global.fetch = jest.fn().mockRejectedValue(new DOMException("timeout", "AbortError"));
    expect(await ownCourierEligibility(address, options)).toEqual({ eligible: false });
    expect(await ownCourierEligibility({ country_code: "ru", city: "Москва" }, options)).toEqual({ eligible: false });
  });

  it("rejects multiple or missing responses", async () => {
    stubClean([inside, inside]);
    expect(await ownCourierEligibility(address, options)).toEqual({ eligible: false });
    stubClean([]);
    expect(await ownCourierEligibility(address, options)).toEqual({ eligible: false });
  });
});

describe("own courier provider", () => {
  it("does not price outside addresses even when client claims inside", async () => {
    stubClean([{ ...inside, beltway_hit: "OUT_MKAD" }]);
    const service = new OwnCourierFulfillmentProviderService({}, options);
    await expect(service.calculatePrice(option, { beltway_hit: "IN_MKAD", city: "Москва" }, { shipping_address: address } as never)).rejects.toThrow();
  });

  it("charges exactly zero after verifying the cart address", async () => {
    stubClean([inside]);
    const service = new OwnCourierFulfillmentProviderService({}, options);
    expect(await service.calculatePrice(option, {}, { shipping_address: address } as never)).toEqual({
      calculated_amount: 0,
      is_calculated_price_tax_inclusive: true,
    });
  });

  it("rechecks on method validation and persists only verified operational data", async () => {
    const request = stubClean([inside]);
    const service = new OwnCourierFulfillmentProviderService({}, options);
    const data = await service.validateFulfillmentData(option, {
      beltway_hit: "IN_MKAD", verified_address: "fake", delivery_mode: "delivered",
    }, { shipping_address: address } as never);
    expect(data).toEqual({ delivery_mode: OWN_COURIER_OPTION, verified_address: inside.result });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("rejects a changed cart address during method validation", async () => {
    stubClean([{ ...inside, beltway_hit: "OUT_MKAD" }]);
    const service = new OwnCourierFulfillmentProviderService({}, options);
    await expect(service.validateFulfillmentData(option, { verified_address: inside.result }, { shipping_address: { ...address, address_1: "за МКАД" } } as never)).rejects.toThrow();
  });

  it("records intent without contacting a carrier or asserting assignment", async () => {
    const service = new OwnCourierFulfillmentProviderService({}, options);
    const request = jest.fn();
    global.fetch = request;
    const result = await service.createFulfillment(
      { delivery_mode: OWN_COURIER_OPTION, verified_address: inside.result, courier_status: "delivered" },
      [], undefined, { shipping_option_id: "so_own_courier_123" },
    );
    expect(result).toEqual({ data: {
      delivery_mode: OWN_COURIER_OPTION, verified_address: inside.result, courier_status: "pending_assignment",
    }, labels: [] });
    expect(request).not.toHaveBeenCalled();
  });

  it.each([
    ["missing mode", { verified_address: inside.result }],
    ["wrong mode", { delivery_mode: "cdek-courier", verified_address: inside.result }],
    ["missing verified address", { delivery_mode: OWN_COURIER_OPTION }],
    ["blank verified address", { delivery_mode: OWN_COURIER_OPTION, verified_address: "  " }],
    ["invalid verified address", { delivery_mode: OWN_COURIER_OPTION, verified_address: 42 }],
  ])("rejects fulfillment with %s", async (_caseName, data) => {
    const service = new OwnCourierFulfillmentProviderService({}, options);
    await expect(service.createFulfillment(data, [], undefined, { shipping_option_id: "so_own_courier_123" }))
      .rejects.toThrow();
  });

  it("rejects unsupported cancellation instead of reporting success", async () => {
    const service = new OwnCourierFulfillmentProviderService({}, options);
    await expect(service.cancelFulfillment({ delivery_mode: OWN_COURIER_OPTION }))
      .rejects.toBeInstanceOf(UnsupportedOwnCourierCancellationError);
  });
});
