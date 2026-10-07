import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { readOnlyParcel } from "../read-only-parcel.mjs";

const run = promisify(execFile);
const measurements = {
  DELIVERY_DISPATCH_INDEX: "119571",
  DELIVERY_DISPATCH_ADDRESS: "Москва, подтверждённый адрес точки Авеню",
  DELIVERY_WEIGHT_GRAMS: "2250",
  DELIVERY_LENGTH_CM: "32",
  DELIVERY_WIDTH_CM: "23",
  DELIVERY_HEIGHT_CM: "14",
  DELIVERY_ASSESSED_PRICE_RUB: "3990.50",
};

async function withCarrierServer(reply, action) {
  const requests = [];
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    requests.push({ method: req.method, url: req.url, body: body ? JSON.parse(body) : undefined });
    const result = reply(req.url);
    res.writeHead(result ? 200 : 404, { "Content-Type": "application/json" });
    res.end(JSON.stringify(result ?? { message: "Unknown carrier operation" }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const url = `http://127.0.0.1:${server.address().port}`;
    await action(url, requests);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("quotes require one known dispatch index, a physical address and measured packing", () => {
  assert.equal(readOnlyParcel(measurements).dispatch.name, "Авеню");
  for (const invalid of [
    { DELIVERY_DISPATCH_INDEX: "108812" },
    { DELIVERY_DISPATCH_INDEX: "__proto__" },
    { DELIVERY_DISPATCH_ADDRESS: " " },
    { DELIVERY_WEIGHT_GRAMS: "" },
    { DELIVERY_LENGTH_CM: "0" },
    { DELIVERY_ASSESSED_PRICE_RUB: "0" },
    { DELIVERY_ASSESSED_PRICE_RUB: "3990.501" },
  ]) {
    assert.throws(() => readOnlyParcel({ ...measurements, ...invalid }));
  }
});

test("Yandex read-only check sends measured parcel from explicit origin and refuses a free quote", async () => {
  let quote = "350.50 RUB";
  await withCarrierServer((url) => {
    if (url === "/api/location/detect") return { variants: [{ geo_id: 213, address: "Москва" }] };
    if (url === "/api/pickup-points/list") return { points: [{ id: "pvz_market_1", type: "pickup_point", operator_id: "market_l4g" }] };
    if (url === "/api/pricing-calculator") return { pricing_total: quote, delivery_days: 2 };
    return null;
  }, async (url, requests) => {
    const options = {
      env: {
        ...process.env,
        ...measurements,
        YANDEX_DELIVERY_API_BASE_URL: `${url}/api`,
        YANDEX_DELIVERY_TOKEN: "fixture-token",
        YANDEX_DELIVERY_SOURCE_STATION_ID: "confirmed_station_avenue",
      },
    };
    const script = fileURLToPath(new URL("../check-yandex.mjs", import.meta.url));
    const first = await run(process.execPath, [script], options);
    assert.match(first.stdout, /350\.50 RUB.*measured parcel/);
    assert.deepEqual(requests.map(({ url: path }) => path), [
      "/api/location/detect", "/api/pickup-points/list", "/api/pricing-calculator",
    ]);
    assert.deepEqual(requests[2].body, {
      source: { platform_station_id: "confirmed_station_avenue" },
      destination: { platform_station_id: "pvz_market_1" },
      tariff: "self_pickup",
      total_weight: 2250,
      total_assessed_price: 399050,
      payment_method: "already_paid",
      places: [{ physical_dims: { weight_gross: 2250, dx: 32, dy: 23, dz: 14 } }],
    });
    quote = "0.00 RUB";
    await assert.rejects(run(process.execPath, [script], options), /malformed response/);
  });
});

test("CDEK read-only check sends measured package for PVZ and courier, never an order", async () => {
  await withCarrierServer((url) => {
    if (url.startsWith("/v2/oauth/token?")) return { access_token: "fixture-token", expires_in: 3600 };
    if (url.startsWith("/v2/location/cities?")) return [{ city: "Москва" }];
    if (url === "/v2/calculator/tarifflist") return { tariff_codes: [{ tariff_code: 136 }, { tariff_code: 137 }] };
    if (url === "/v2/calculator/tariff") return { delivery_sum: 350.5 };
    return null;
  }, async (url, requests) => {
    const script = fileURLToPath(new URL("../check-cdek.mjs", import.meta.url));
    const result = await run(process.execPath, [script], {
      env: {
        ...process.env,
        ...measurements,
        CDEK_API_BASE_URL: `${url}/v2`,
        CDEK_CLIENT_ID: "fixture-client",
        CDEK_CLIENT_SECRET: "fixture-secret",
        CDEK_FROM_CITY_CODE: "44",
        CDEK_TO_CITY_CODE: "137",
      },
    });
    assert.match(result.stdout, /Tariff 136: OK \(350\.5 RUB\)/);
    assert.match(result.stdout, /Tariff 137: OK \(350\.5 RUB\)/);
    assert.deepEqual(requests.map(({ url: path }) => path.split("?")[0]), [
      "/v2/oauth/token", "/v2/location/cities", "/v2/location/cities",
      "/v2/calculator/tarifflist", "/v2/calculator/tariff", "/v2/calculator/tariff",
    ]);
    for (const request of requests.filter(({ url: path }) => path.startsWith("/v2/calculator/"))) {
      assert.deepEqual(request.body.packages, [{ weight: 2250, length: 32, width: 23, height: 14 }]);
      assert.equal(request.body.from_location.code, 44);
      assert.equal(request.body.to_location.code, 137);
    }
  });
});
