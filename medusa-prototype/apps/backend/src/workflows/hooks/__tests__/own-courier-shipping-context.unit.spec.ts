import { shippingContext } from "../own-courier-shipping-context";

const address = { country_code: "ru", city: "Москва", address_1: "ул Сухонская, д 11" };
const inside = {
  result: "г Москва, ул Сухонская, д 11", beltway_hit: "IN_MKAD",
  country_iso_code: "RU", region_iso_code: "RU-MOW", house: "11",
  qc: 0, qc_geo: 0, unparsed_parts: null,
};
const container = { resolve: () => ({ graph: async () => ({ data: [{ shipping_address: address }] }) }) };

describe("shipping option listing context", () => {
  const originalToken = process.env.DADATA_API_KEY;
  const originalSecret = process.env.DADATA_SECRET_KEY;

  afterEach(() => {
    if (originalToken === undefined) delete process.env.DADATA_API_KEY;
    else process.env.DADATA_API_KEY = originalToken;
    if (originalSecret === undefined) delete process.env.DADATA_SECRET_KEY;
    else process.env.DADATA_SECRET_KEY = originalSecret;
    jest.restoreAllMocks();
  });

  it("excludes own courier without both credentials without contacting DaData", async () => {
    delete process.env.DADATA_API_KEY;
    delete process.env.DADATA_SECRET_KEY;
    const request = jest.fn();
    global.fetch = request;
    const result = await shippingContext({ cart: { id: "cart_1" } }, { container } as never);
    expect(result.output).toEqual({ own_courier_mkad_verified: "false" });
    expect(request).not.toHaveBeenCalled();
  });

  it("includes own courier only when DaData verifies the cart address", async () => {
    process.env.DADATA_API_KEY = "test-token";
    process.env.DADATA_SECRET_KEY = "test-secret";
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => [inside] });
    const spoofedCart = { id: "cart_1", shipping_address: { ...address, address_1: "за МКАД" } };
    expect((await shippingContext({ cart: spoofedCart }, { container } as never)).output).toEqual({ own_courier_mkad_verified: "true" });
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 429 });
    expect((await shippingContext({ cart: { id: "cart_1" } }, { container } as never)).output).toEqual({ own_courier_mkad_verified: "false" });
  });

  it("excludes own courier when the authoritative cart lookup fails", async () => {
    process.env.DADATA_API_KEY = "test-token";
    process.env.DADATA_SECRET_KEY = "test-secret";
    const request = jest.fn();
    global.fetch = request;
    const unavailableCart = { resolve: () => ({ graph: async () => { throw new Error("cart unavailable"); } }) };
    expect((await shippingContext({ cart: { id: "cart_1" } }, { container: unavailableCart } as never)).output)
      .toEqual({ own_courier_mkad_verified: "false" });
    expect(request).not.toHaveBeenCalled();
  });
});
