const required = (name) => {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is missing in medusa-prototype/apps/backend/.env.integrations.local`);
  }
  return value;
};

const baseUrl = required("CDEK_API_BASE_URL").replace(/\/$/, "");
const clientId = required("CDEK_CLIENT_ID");
const clientSecret = required("CDEK_CLIENT_SECRET");
const fromCityCode = Number(required("CDEK_FROM_CITY_CODE"));
const toCityCode = Number(process.env.CDEK_TO_CITY_CODE || 137);

if (!Number.isInteger(fromCityCode) || !Number.isInteger(toCityCode)) {
  throw new Error("CDEK_FROM_CITY_CODE and CDEK_TO_CITY_CODE must be integers");
}

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
    throw new Error(`${label}: CDEK returned non-JSON HTTP ${response.status}`);
  }
  if (!response.ok) {
    const details = payload?.message || payload?.errors?.[0]?.message || JSON.stringify(payload);
    throw new Error(`${label}: CDEK returned HTTP ${response.status}: ${details}`);
  }
  return payload;
}

async function main() {
  console.log(`CDEK environment: ${baseUrl}`);

  const tokenBody = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
  });
  const token = await fetchJson(
    `${baseUrl}/oauth/token?${tokenBody.toString()}`,
    { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" } },
    "OAuth",
  );
  if (typeof token?.access_token !== "string" || !token.access_token) {
    throw new Error("OAuth: response has no access_token");
  }
  console.log(`OAuth: OK (expires in ${token.expires_in ?? "unknown"} seconds)`);

  const headers = {
    Authorization: `Bearer ${token.access_token}`,
    "Content-Type": "application/json",
  };
  const cities = await Promise.all(
    [fromCityCode, toCityCode].map((code) =>
      fetchJson(`${baseUrl}/location/cities?code=${code}`, { headers }, `City ${code}`),
    ),
  );
  const cityNames = cities.map((items, index) => {
    const code = index === 0 ? fromCityCode : toCityCode;
    return Array.isArray(items) && items[0]?.city ? `${items[0].city} (${code})` : `code ${code}`;
  });
  console.log(`Cities: ${cityNames.join(" -> ")}`);

  const tariffs = await fetchJson(
    `${baseUrl}/calculator/tarifflist`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        type: 1,
        lang: "rus",
        from_location: { code: fromCityCode },
        to_location: { code: toCityCode },
        packages: [{ weight: 1000, length: 30, width: 20, height: 10 }],
      }),
    },
    "Tariff calculation",
  );
  const available = Array.isArray(tariffs?.tariff_codes) ? tariffs.tariff_codes : [];
  if (available.length === 0) {
    throw new Error("Tariff calculation: no tariffs returned for the sample parcel");
  }
  console.log(`Tariffs: OK (${available.length} available)`);
  const now = new Date(Date.now() + 3 * 60 * 60 * 1000);
  const pad = (value) => String(value).padStart(2, "0");
  const date = `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())}T${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())}:${pad(now.getUTCSeconds())}+0300`;
  for (const tariffCode of [136, 137]) {
    const quote = await fetchJson(`${baseUrl}/calculator/tariff`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        date,
        type: 1,
        currency: 1,
        lang: "rus",
        tariff_code: tariffCode,
        from_location: { code: fromCityCode },
        to_location: { code: toCityCode },
        packages: [{ weight: 1000, length: 30, width: 20, height: 10 }],
      }),
    }, `Tariff ${tariffCode}`);
    if (typeof quote?.delivery_sum !== "number" || !Number.isFinite(quote.delivery_sum) || quote.delivery_sum < 0) {
      throw new Error(`Tariff ${tariffCode}: no valid carrier quote`);
    }
    console.log(`Tariff ${tariffCode}: OK (${quote.delivery_sum} RUB)`);
  }
}

main().catch((error) => {
  console.error(`CDEK check failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
