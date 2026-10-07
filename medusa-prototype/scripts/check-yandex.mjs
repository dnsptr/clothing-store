import { readOnlyParcel } from "./read-only-parcel.mjs";

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
const { dispatch, parcel } = readOnlyParcel(process.env);

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
  console.log(`Specified dispatch: ${dispatch.name} (${dispatch.postalCode}), ${dispatch.address}`);
  console.log(`Measured parcel: ${parcel.weight} g, ${parcel.length}x${parcel.width}x${parcel.height} cm, assessed ${parcel.assessedPrice} RUB`);
  console.log("Verify the configured Yandex source station belongs to this physical dispatch address before using a quote for orders.");
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
    (entry) => typeof entry?.id === "string" && entry.id.trim() &&
      entry.type === "pickup_point" && entry.operator_id === "market_l4g",
  );
  if (!point) throw new Error("PVZ list: no Yandex Market pickup point available for measured calculation");
  console.log(`PVZ list: OK (${pickupPoints.points.length} points)`);

  // The destination is one Yandex Market PVZ in Moscow; this is a read-only
  // quote for the supplied measured parcel, not a shipment or a checkout tariff.
  const estimate = await postJson(
    "/pricing-calculator",
    {
      source: { platform_station_id: sourceStationId },
      destination: { platform_station_id: point.id },
      tariff: "self_pickup",
      total_weight: parcel.weight,
      total_assessed_price: Math.round(parcel.assessedPrice * 100),
      payment_method: "already_paid",
      places: [{ physical_dims: {
        weight_gross: parcel.weight,
        dx: parcel.length, dy: parcel.width, dz: parcel.height,
      } }],
    },
    "PVZ price calculation",
  );
  const price = typeof estimate?.pricing_total === "string"
    ? Number(estimate.pricing_total.slice(0, -4))
    : Number.NaN;
  if (typeof estimate?.pricing_total !== "string" ||
      !/^\d+(?:\.\d{1,2})? RUB$/u.test(estimate.pricing_total) ||
      (!Number.isFinite(price) || price <= 0) ||
      (estimate.delivery_days !== undefined &&
        (!Number.isInteger(estimate.delivery_days) || estimate.delivery_days < 0))) {
    throw new Error("PVZ price calculation: malformed response");
  }
  const transit = estimate.delivery_days === undefined ? "" : `; ${estimate.delivery_days} days`;
  console.log(`PVZ price calculation: OK (${estimate.pricing_total}${transit}, measured parcel to ${point.id})`);
  console.log("Read-only check complete; no offer or shipment was created.");
}

main().catch((error) => {
  console.error(`Yandex Delivery check failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
