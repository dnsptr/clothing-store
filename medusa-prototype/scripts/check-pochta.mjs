const required = (name) => {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is missing in medusa-prototype/apps/backend/.env.integrations.local`);
  }
  return value;
};

const baseUrl = (process.env.POCHTA_API_BASE_URL || "https://otpravka-api.pochta.ru/1.0").replace(/\/$/, "");
const accessToken = required("POCHTA_ACCESS_TOKEN");
const userKey = required("POCHTA_USER_KEY");
const fromIndex = required("POCHTA_FROM_INDEX");
const toIndex = process.env.POCHTA_TO_INDEX || "190000";

async function fetchJson(url, init, label) {
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(15_000),
  });
  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`${label}: Pochta returned non-JSON HTTP ${response.status}`);
  }
  if (!response.ok) {
    const details = payload?.desc || payload?.message || JSON.stringify(payload);
    throw new Error(`${label}: Pochta returned HTTP ${response.status}: ${details}`);
  }
  return payload;
}

async function main() {
  console.log(`Russian Post environment: ${baseUrl}`);

  const headers = {
    Authorization: `AccessToken ${accessToken}`,
    "X-User-Authorization": `Basic ${userKey}`,
    "Content-Type": "application/json;charset=UTF-8",
  };

  console.log(`Calculating tariffs from ${fromIndex} to ${toIndex} (sample destination)...`);

  const [parcelTariff, courierTariff] = await Promise.all([
    fetchJson(
      `${baseUrl}/tariff`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          "index-from": fromIndex,
          "index-to": toIndex,
          "mail-category": "ORDINARY",
          "mail-type": "ONLINE_PARCEL",
          mass: 1200,
          dimension: { length: 35, width: 25, height: 15 },
        }),
      },
      "Parcel online calculation",
    ),
    fetchJson(
      `${baseUrl}/tariff`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          "index-from": fromIndex,
          "index-to": toIndex,
          "mail-category": "ORDINARY",
          "mail-type": "ONLINE_COURIER",
          mass: 1200,
          dimension: { length: 35, width: 25, height: 15 },
        }),
      },
      "Courier online calculation",
    ),
  ]);

  const parcelPrice = Math.round(Number(parcelTariff["total-rate"]) / 100);
  const parcelMin = parcelTariff["delivery-time"]?.["min-days"] || "?";
  const parcelMax = parcelTariff["delivery-time"]?.["max-days"] || "?";
  console.log(`Pochta Parcel Online: OK (${parcelPrice} RUB, ${parcelMin}-${parcelMax} days)`);

  const courierPrice = Math.round(Number(courierTariff["total-rate"]) / 100);
  const courierMin = courierTariff["delivery-time"]?.["min-days"] || "?";
  const courierMax = courierTariff["delivery-time"]?.["max-days"] || "?";
  console.log(`Pochta Courier Online: OK (${courierPrice} RUB, ${courierMin}-${courierMax} days)`);
}

main().catch((error) => {
  console.error(`Pochta check failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
