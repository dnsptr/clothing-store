const required = (name) => {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is missing in medusa-prototype/apps/backend/.env.integrations.local`);
  }
  return value;
};

const baseUrl = (process.env.YANDEX_DELIVERY_API_BASE_URL || "https://b2b-authproxy.taxi.yandex.net/api/b2b/platform").replace(/\/$/, "");
const token = required("YANDEX_DELIVERY_TOKEN");
const sourceStationId = required("YANDEX_DELIVERY_SOURCE_STATION_ID");

async function postJson(endpoint, body, label) {
  const response = await fetch(`${baseUrl}${endpoint}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "Accept-Language": "ru",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error(`${label}: Yandex Delivery returned non-JSON HTTP ${response.status}`);
  }
  if (!response.ok) {
    throw new Error(`${label}: Yandex Delivery returned HTTP ${response.status}`);
  }
  return payload;
}

async function main() {
  console.log(`Yandex Delivery environment: ${baseUrl}`);
  const location = await postJson("/location/detect", { location: "Москва" }, "City lookup");
  const geoId = location?.variants?.find(
    (variant) => Number.isInteger(variant?.geo_id) && variant.geo_id >= 0,
  )?.geo_id;
  if (geoId === undefined) throw new Error("City lookup: no valid geo_id for Moscow");
  console.log("City lookup: OK");

  const pickupPoints = await postJson(
    "/pickup-points/list",
    { geo_id: geoId, type: "pickup_point", operator_ids: ["market_l4g"], payment_method: "already_paid" },
    "PVZ list",
  );
  if (!Array.isArray(pickupPoints?.points)) throw new Error("PVZ list: malformed response");
  const point = pickupPoints.points.find(
    (entry) => typeof entry?.id === "string" && entry.id.trim() && entry.type === "pickup_point",
  );
  if (!point) throw new Error("PVZ list: no Yandex Market pickup point available for sample calculation");
  console.log(`PVZ list: OK (${pickupPoints.points.length} points)`);

  // Illustrative parcel only: these measurements are not product data.
  const estimate = await postJson(
    "/pricing-calculator",
    {
      source: { platform_station_id: sourceStationId },
      destination: { platform_station_id: point.id },
      tariff: "self_pickup",
      total_weight: 1000,
      total_assessed_price: 150000,
      client_price: 0,
      payment_method: "already_paid",
      places: [{ physical_dims: { weight_gross: 1000, dx: 20, dy: 15, dz: 10 } }],
    },
    "PVZ price calculation",
  );
  if (typeof estimate?.pricing_total !== "string" ||
      !/^\d+(?:\.\d{1,2})? RUB$/u.test(estimate.pricing_total) ||
      (estimate.delivery_days !== undefined &&
        (!Number.isInteger(estimate.delivery_days) || estimate.delivery_days < 0))) {
    throw new Error("PVZ price calculation: malformed response");
  }
  const transit = estimate.delivery_days === undefined ? "" : `; ${estimate.delivery_days} days`;
  console.log(`PVZ price calculation: OK (${estimate.pricing_total}${transit}, sample parcel only)`);
  console.log("Read-only check complete; no offer or shipment was created.");
}

main().catch((error) => {
  console.error(`Yandex Delivery check failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
