import { CdekClient, CdekApiError } from "../lib/cdek-client";
import type { CdekProviderOptions } from "../config";

const TEST_OPTIONS: CdekProviderOptions = {
  clientId: "mock-client-id",
  clientSecret: "mock-client-secret",
  apiBaseUrl: "https://api.edu.cdek.ru/v2",
  fromCityCode: 44,
  pvzPriceRub: 350,
  courierPriceRub: 650,
};

const ORDER_ITEM = {
  name: "Рубашка хлопковая, размер M",
  ware_key: "variant_shirt",
  cost: 2500,
  amount: 1 as const,
  payment: { value: 0 as const },
};

describe("CdekClient", () => {
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it("obtains and caches OAuth token", async () => {
    let tokenRequests = 0;
    const userAgents: string[] = [];
    const token = "x".repeat(1_426);
    global.fetch = jest.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const urlStr = String(url);
      userAgents.push(new Headers(init?.headers).get("User-Agent") ?? "");
      if (urlStr.includes("/oauth/token")) {
        tokenRequests++;
        return {
          ok: true,
          status: 200,
          json: async () => ({ access_token: token, expires_in: 3600 }),
          text: async () => JSON.stringify({ access_token: token, expires_in: 3600 }),
        } as unknown as Response;
      }
      if (urlStr.includes("/location/cities")) {
        return {
          ok: true,
          status: 200,
          json: async () => [{ code: 44, city: "Москва" }],
          text: async () => JSON.stringify([{ code: 44, city: "Москва" }]),
        } as unknown as Response;
      }
      return { ok: false, status: 404, text: async () => "Not found" } as unknown as Response;
    });

    const client = new CdekClient(TEST_OPTIONS);

    // Call 1
    const cities1 = await client.searchCities("Моск");
    expect(cities1).toHaveLength(1);
    expect(cities1[0].city).toBe("Москва");
    expect(tokenRequests).toBe(1);

    // Call 2 should use cached token
    const cities2 = await client.searchCities("Моск");
    expect(cities2).toHaveLength(1);
    expect(tokenRequests).toBe(1);
    expect(userAgents).toEqual(Array(3).fill("MarioMikkeStore/1.0"));
  });

  it("retries request when token expires with 401", async () => {
    let callCount = 0;
    global.fetch = jest.fn(async (url: RequestInfo | URL) => {
      const urlStr = String(url);
      if (urlStr.includes("/oauth/token")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ access_token: "mock-token-refresh", expires_in: 3600 }),
          text: async () => JSON.stringify({ access_token: "mock-token-refresh", expires_in: 3600 }),
        } as unknown as Response;
      }
      if (urlStr.includes("/deliverypoints")) {
        callCount++;
        if (callCount === 1) {
          // First attempt fails with 401
          return {
            ok: false,
            status: 401,
            json: async () => ({ message: "Unauthorized" }),
            text: async () => JSON.stringify({ message: "Unauthorized" }),
          } as unknown as Response;
        }
        // Second attempt succeeds
        return {
          ok: true,
          status: 200,
          json: async () => [
            {
              code: "MSK1",
              name: "ПВЗ Тверская",
              type: "PVZ",
              location: { address: "ул. Тверская 1", city_code: 44, city: "Москва" },
              work_time: "10-20",
            },
          ],
          text: async () =>
            JSON.stringify([
              {
                code: "MSK1",
                name: "ПВЗ Тверская",
                type: "PVZ",
                location: { address: "ул. Тверская 1", city_code: 44, city: "Москва" },
                work_time: "10-20",
              },
            ]),
        } as unknown as Response;
      }
      return { ok: false, status: 404, text: async () => "" } as unknown as Response;
    });

    const client = new CdekClient(TEST_OPTIONS);
    const pvz = await client.getDeliveryPoints(44);
    expect(pvz).toHaveLength(1);
    expect(pvz[0].code).toBe("MSK1");
    expect(callCount).toBe(2);
  });

  it("calculates tariff successfully", async () => {
    global.fetch = jest.fn(async (url: RequestInfo | URL) => {
      const urlStr = String(url);
      if (urlStr.includes("/oauth/token")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ access_token: "mock-token", expires_in: 3600 }),
          text: async () => JSON.stringify({ access_token: "mock-token", expires_in: 3600 }),
        } as unknown as Response;
      }
      if (urlStr.includes("/calculator/tariff")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            delivery_sum: 250,
            period_min: 1,
            period_max: 3,
            delivery_date_range: { min: "2026-09-20", max: "2026-09-22" },
          }),
          text: async () =>
            JSON.stringify({
              delivery_sum: 250,
              period_min: 1,
              period_max: 3,
              delivery_date_range: { min: "2026-09-20", max: "2026-09-22" },
            }),
        } as unknown as Response;
      }
      return { ok: false, status: 404, text: async () => "" } as unknown as Response;
    });

    const client = new CdekClient(TEST_OPTIONS);
    const result = await client.calculateTariff({
      toCityCode: 137,
      tariffCode: 136,
      packages: [{ weight: 1_000, length: 25, width: 20, height: 10 }],
    });

    expect(result.delivery_sum).toBe(250);
    expect(result.period_min).toBe(1);
    expect(result.period_max).toBe(3);
    expect(result.tariff_code).toBe(136);
  });

  it("queries reception-enabled PVZ separately from buyer handout points", async () => {
    const urls: string[] = [];
    global.fetch = jest.fn(async (url: RequestInfo | URL) => {
      urls.push(String(url));
      if (String(url).includes("/oauth/token")) {
        return new Response(JSON.stringify({ access_token: "token", expires_in: 3600 }));
      }
      return new Response(JSON.stringify([{
        code: "SPB10", name: "Пункт отправки", type: "PVZ", is_reception: true,
        location: { city_code: 137, city: "Санкт-Петербург", address: "Невский, 10" },
        work_time: "10:00-20:00",
      }]));
    });
    const points = await new CdekClient(TEST_OPTIONS).getReceptionPoints(137, "SPB10");
    const request = new URL(urls[1]);
    expect(request.pathname).toBe("/v2/deliverypoints");
    expect(Object.fromEntries(request.searchParams)).toEqual({
      city_code: "137", code: "SPB10", type: "PVZ", is_reception: "true", lang: "rus",
    });
    expect(points[0].is_reception).toBe(true);
  });

  it("uses an explicit source city for checkout but keeps the configured city for diagnostics", async () => {
    const bodies: unknown[] = [];
    global.fetch = jest.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      if (String(url).includes("/oauth/token")) {
        return new Response(JSON.stringify({ access_token: "token", expires_in: 3600 }));
      }
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ delivery_sum: 550, period_min: 1, period_max: 3 }));
    });
    const client = new CdekClient(TEST_OPTIONS);
    const input = { toCityCode: 44, tariffCode: 136, packages: [{ weight: 700, length: 30, width: 25, height: 10 }] };
    await client.calculateTariff({ ...input, fromCityCode: 137 });
    await client.calculateTariff(input);
    expect(bodies).toEqual([
      expect.objectContaining({ from_location: { code: 137 } }),
      expect.objectContaining({ from_location: { code: 44 } }),
    ]);
  });

  it("uses Moscow UTC+03 time and the supported parsed tariff in its request", async () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-01-02T22:04:05.000Z"));
    const requestBodies: unknown[] = [];
    global.fetch = jest.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      if (String(url).includes("/oauth/token")) {
        return { ok: true, status: 200, text: async () => JSON.stringify({ access_token: "mock-token", expires_in: 3600 }) } as Response;
      }
      requestBodies.push(JSON.parse(String(init?.body)));
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ delivery_sum: 250, period_min: 1, period_max: 3 }),
      } as Response;
    });

    const result = await new CdekClient(TEST_OPTIONS).calculateTariff({
      toCityCode: 137,
      tariffCode: 136,
      packages: [{ weight: 1_000, length: 25, width: 20, height: 10 }],
    });

    expect(requestBodies).toEqual([expect.objectContaining({ date: "2026-01-03T01:04:05+0300", tariff_code: 136 })]);
    expect(result).toMatchObject({ tariff_code: 136, tariff_name: "СДЭК — Доставка в пункт выдачи (ПВЗ)" });
  });

  it("sends destination city code in a courier order payload", async () => {
    const requestBodies: unknown[] = [];
    global.fetch = jest.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      if (String(url).includes("/oauth/token")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ access_token: "mock-token", expires_in: 3600 }),
          text: async () => JSON.stringify({ access_token: "mock-token", expires_in: 3600 }),
        } as Response;
      }
      requestBodies.push(JSON.parse(String(init?.body)));
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          entity: { uuid: "order-uuid" },
          requests: [{
            request_uuid: "request-uuid",
            type: "CREATE",
            state: "ACCEPTED",
            date_time: "2026-09-21T00:00:00+0000",
          }],
        }),
      } as Response;
    });

    const client = new CdekClient(TEST_OPTIONS);
    await client.createOrder({
      shipmentPoint: "MSK65",
      orderNumber: "ORD-1",
      tariffCode: 137,
      recipient: { name: "Иван", phones: [{ number: "+79991234567" }] },
      toAddress: { cityCode: 137, address: "Невский проспект, 1" },
      packages: [
        { number: "shirt-1", weight: 700, length: 30, width: 25, height: 10, items: [{ ...ORDER_ITEM, weight: 700 }] },
        { number: "shirt-2", weight: 700, length: 30, width: 25, height: 10, items: [{ ...ORDER_ITEM, weight: 700 }] },
      ],
    });

    expect(requestBodies[0]).toMatchObject({
      tariff_code: 137,
      to_location: { code: 137, address: "Невский проспект, 1" },
      shipment_point: "MSK65",
      delivery_recipient_cost: { value: 0 },
      packages: [
        { number: "shirt-1", weight: 700, length: 30, width: 25, height: 10, items: [{ ...ORDER_ITEM, weight: 700 }] },
        { number: "shirt-2", weight: 700, length: 30, width: 25, height: 10, items: [{ ...ORDER_ITEM, weight: 700 }] },
      ],
    });
  });

  it("rejects a shipment response that CDEK marks invalid", async () => {
    global.fetch = jest.fn(async (url: RequestInfo | URL) => {
      if (String(url).includes("/oauth/token")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ access_token: "mock-token", expires_in: 3600 }),
          text: async () => JSON.stringify({ access_token: "mock-token", expires_in: 3600 }),
        } as Response;
      }
      return {
        ok: true,
        status: 202,
        text: async () => JSON.stringify({
          entity: { uuid: "invalid-order-uuid" },
          requests: [{
            request_uuid: "request-uuid",
            type: "CREATE",
            state: "INVALID",
            date_time: "2026-09-21T00:00:00+0000",
          }],
        }),
      } as Response;
    });

    const client = new CdekClient(TEST_OPTIONS);
    await expect(client.createOrder({ shipmentPoint: "MSK65", orderNumber: "ORD-invalid",
    tariffCode: 137,
    recipient: { name: "Иван", phones: [{ number: "+79991234567" }] },
    toAddress: { cityCode: 137, address: "Невский проспект, 1" },
    packages: [{ number: "1", weight: 700, length: 30, width: 25, height: 10, items: [{ ...ORDER_ITEM, weight: 700 }] }], })).rejects.toThrow(CdekApiError);
  });

  it("throws CdekApiError on non-2xx response from CDEK API", async () => {
    global.fetch = jest.fn(async (url: RequestInfo | URL) => {
      const urlStr = String(url);
      if (urlStr.includes("/oauth/token")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ access_token: "mock-token", expires_in: 3600 }),
          text: async () => JSON.stringify({ access_token: "mock-token", expires_in: 3600 }),
        } as unknown as Response;
      }
      return {
        ok: false,
        status: 400,
        json: async () => ({ errors: [{ code: "v2_bad_request", message: "Invalid city code" }] }),
        text: async () =>
          JSON.stringify({ errors: [{ code: "v2_bad_request", message: "Invalid city code" }] }),
      } as unknown as Response;
    });

    const client = new CdekClient(TEST_OPTIONS);
    await expect(client.getDeliveryPoints(999999)).rejects.toThrow(CdekApiError);
  });

  it("rejects malformed city search entries instead of coercing them", async () => {
    global.fetch = jest.fn(async (url: RequestInfo | URL) => {
      if (String(url).includes("/oauth/token")) {
        return { ok: true, status: 200, text: async () => JSON.stringify({ access_token: "mock-token", expires_in: 3600 }) } as Response;
      }
      return { ok: true, status: 200, text: async () => JSON.stringify([{ code: "44", city: "Москва" }]) } as Response;
    });

    await expect(new CdekClient(TEST_OPTIONS).searchCities("Москва")).rejects.toThrow(CdekApiError);
  });

  it("rejects malformed delivery point, tariff, order, and status responses", async () => {
    const client = new CdekClient(TEST_OPTIONS);
    global.fetch = jest.fn(async (url: RequestInfo | URL) => {
      if (String(url).includes("/oauth/token")) {
        return { ok: true, status: 200, text: async () => JSON.stringify({ access_token: "mock-token", expires_in: 3600 }) } as Response;
      }
      if (String(url).includes("/deliverypoints")) return { ok: true, status: 200, text: async () => JSON.stringify({}) } as Response;
      return { ok: true, status: 200, text: async () => JSON.stringify({}) } as Response;
    });

    await expect(client.getDeliveryPoints(44)).rejects.toThrow(CdekApiError);
    await expect(client.calculateTariff({ toCityCode: 44, tariffCode: 136, packages: [{ weight: 1_000, length: 25, width: 20, height: 10 }] })).rejects.toThrow(CdekApiError);
    await expect(client.createOrder({ shipmentPoint: "MSK65", orderNumber: "ORD-1", tariffCode: 136, recipient: { name: "Иван", phones: [{ number: "+79991234567" }] }, packages: [{ number: "1", weight: 1_000, length: 25, width: 20, height: 10, items: [{ ...ORDER_ITEM, weight: 1_000 }] }], deliveryPoint: "MSK1" })).rejects.toThrow(CdekApiError);
    await expect(client.getOrder("order-uuid")).rejects.toThrow(CdekApiError);
  });

  it("rejects absent or invalid tariff packages before contacting CDEK", async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock;
    const client = new CdekClient(TEST_OPTIONS);

    await expect(client.calculateTariff({ toCityCode: 44, tariffCode: 136, packages: [] })).rejects.toThrow(CdekApiError);
    await expect(client.calculateTariff({ toCityCode: 44, tariffCode: 136, packages: [{ weight: Number.POSITIVE_INFINITY, length: 25, width: 20, height: 10 }] })).rejects.toThrow(CdekApiError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects unsupported tariff codes before contacting CDEK", async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock;

    await expect(new CdekClient(TEST_OPTIONS).calculateTariff({
      toCityCode: 44,
      tariffCode: 999,
      packages: [{ weight: 1_000, length: 25, width: 20, height: 10 }],
    })).rejects.toThrow(CdekApiError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects invalid order recipient, tariff, or destination before contacting CDEK", async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock;
    const client = new CdekClient(TEST_OPTIONS);
    const packages = [{ number: "1", weight: 1_000, length: 25, width: 20, height: 10, items: [{ ...ORDER_ITEM, weight: 1_000 }] }];
    const recipient = { name: "Иван", phones: [{ number: "+79991234567" }] };

    await expect(client.createOrder({ shipmentPoint: "MSK65", orderNumber: "ORD-1", tariffCode: 999, recipient, packages, deliveryPoint: "MSK1" })).rejects.toThrow(CdekApiError);
    await expect(client.createOrder({ shipmentPoint: "MSK65", orderNumber: "ORD-1", tariffCode: 136, recipient: { name: "", phones: [{ number: "+79991234567" }] }, packages, deliveryPoint: "MSK1" })).rejects.toThrow(CdekApiError);
    await expect(client.createOrder({ shipmentPoint: "MSK65", orderNumber: "ORD-1", tariffCode: 136, recipient: { name: "Иван", phones: [{ number: "not-a-phone" }] }, packages, deliveryPoint: "MSK1" })).rejects.toThrow(CdekApiError);
    await expect(client.createOrder({ shipmentPoint: "MSK65", orderNumber: "ORD-1", tariffCode: 136, recipient: { name: "Иван", phones: [{ number: "+79991234567" }], email: "invalid-email" }, packages, deliveryPoint: "MSK1" })).rejects.toThrow(CdekApiError);
    await expect(client.createOrder({ shipmentPoint: "MSK65", orderNumber: "ORD-1", tariffCode: 136, recipient, packages })).rejects.toThrow(CdekApiError);
    await expect(client.createOrder({ shipmentPoint: "MSK65", orderNumber: "ORD-1", tariffCode: 136, recipient, packages, deliveryPoint: "MSK1", toAddress: { cityCode: 44, address: "Тверская, 1" } })).rejects.toThrow(CdekApiError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    { items: [] },
    { items: [{ ...ORDER_ITEM, weight: 700, cost: Number.NaN }] },
    { items: [{ ...ORDER_ITEM, weight: 700, name: "" }] },
    { items: [{ ...ORDER_ITEM, weight: 700, payment: { value: 10 } }] },
    { items: [{ ...ORDER_ITEM, weight: 700, payment: { value: 0, vat_rate: 22 } }] },
    { items: [{ ...ORDER_ITEM, weight: 700, amount: 2 }] },
  ])("rejects unsupported internet-shop contents before network access: %j", async ({ items }) => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock;
    const valid = {
      shipmentPoint: "MSK65", orderNumber: "ORD-1", tariffCode: 136,
      recipient: { name: "Иван", phones: [{ number: "+79991234567" }] },
      packages: [{ number: "1", weight: 700, length: 30, width: 25, height: 10, items }],
      deliveryPoint: "MSK1",
    };
    // These deliberately invalid contents exercise the runtime client boundary.
    const input = valid as unknown as Parameters<CdekClient["createOrder"]>[0];
    await expect(new CdekClient(TEST_OPTIONS).createOrder(input)).rejects.toThrow(CdekApiError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects duplicate package numbers and absent handoff before network access", async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock;
    const client = new CdekClient(TEST_OPTIONS);
    const place = { number: "1", weight: 700, length: 30, width: 25, height: 10, items: [{ ...ORDER_ITEM, weight: 700 }] };
    const input = {
      shipmentPoint: "MSK65", orderNumber: "ORD-1", tariffCode: 136,
      recipient: { name: "Иван", phones: [{ number: "+79991234567" }] },
      packages: [place, place], deliveryPoint: "MSK1",
    };
    await expect(client.createOrder(input)).rejects.toThrow(CdekApiError);
    await expect(client.createOrder({ ...input, shipmentPoint: "", packages: [place] })).rejects.toThrow(CdekApiError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

});
