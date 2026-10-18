import { isMedusaConfigured, medusaRequest } from "./medusa";

export interface CdekCity {
  code: number;
  city: string;
  region?: string;
  sub_region?: string;
}

export interface CdekDeliveryPoint {
  code: string;
  name: string;
  type: "PVZ" | "POSTAMAT";
  location: {
    address: string;
    address_full?: string;
    city_code: number;
    city: string;
    latitude?: number;
    longitude?: number;
  };
  work_time: string;
  phones?: Array<{ number: string }>;
  note?: string;
  nearest_metro_station?: string;
}

export interface PickupStore {
  id: string;
  name: string;
  address: string;
  metro: string;
  workHours: string;
  phone: string;
}

export class CdekDeliveryUnavailableError extends Error {
  readonly name = "CdekDeliveryUnavailableError";

  constructor() {
    super("CDEK delivery unavailable");
  }
}

function unavailable(): never {
  throw new CdekDeliveryUnavailableError();
}

function record(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return Object.fromEntries(Object.entries(value));
}

function requiredString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function requiredPositiveInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

function optionalFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function parseCity(value: unknown): CdekCity {
  const city = record(value);
  const code = city && requiredPositiveInteger(city.code);
  const name = city && requiredString(city.city);
  if (code === null || !name) unavailable();
  const region = optionalString(city.region);
  const subRegion = optionalString(city.sub_region);
  return { code, city: name, ...(region ? { region } : {}), ...(subRegion ? { sub_region: subRegion } : {}) };
}

function parseDeliveryPoint(value: unknown): CdekDeliveryPoint {
  const point = record(value);
  const location = point && record(point.location);
  const code = point && requiredString(point.code);
  const name = point && requiredString(point.name);
  const type = point?.type;
  const address = location && requiredString(location.address);
  const cityCode = location && requiredPositiveInteger(location.city_code);
  const city = location && requiredString(location.city);
  const workTime = point && requiredString(point.work_time);
  if (!code || !name || (type !== "PVZ" && type !== "POSTAMAT") || !address || cityCode === null || !city || !workTime) unavailable();

  const addressFull = optionalString(location.address_full);
  const latitude = optionalFiniteNumber(location.latitude);
  const longitude = optionalFiniteNumber(location.longitude);
  const note = optionalString(point.note);
  const nearestMetroStation = optionalString(point.nearest_metro_station);
  return {
    code,
    name,
    type,
    location: {
      address,
      city_code: cityCode,
      city,
      ...(addressFull ? { address_full: addressFull } : {}),
      ...(latitude === undefined ? {} : { latitude }),
      ...(longitude === undefined ? {} : { longitude }),
    },
    work_time: workTime,
    ...(note ? { note } : {}),
    ...(nearestMetroStation ? { nearest_metro_station: nearestMetroStation } : {}),
  };
}

function parseResponseList<T>(payload: unknown, property: string, parseItem: (value: unknown) => T): T[] {
  const response = record(payload);
  const values = response?.[property];
  if (!Array.isArray(values)) unavailable();
  return values.map(parseItem);
}

export const MARIO_MIKKE_PICKUP_STORES: PickupStore[] = [
  {
    id: "store_vodny",
    name: "ТЦ «Водный»",
    address: "г. Москва, Головинское шоссе, д. 5, корп. 1",
    metro: "м. Водный стадион",
    workHours: "10:00 — 22:00 ежедневно",
    phone: "+7 (926) 057-72-05",
  },
  {
    id: "store_govorovo",
    name: "ТЦ «Говорово»",
    address: "г. Москва, 47-й км МКАД, вл. 31, стр. 1",
    metro: "м. Говорово",
    workHours: "10:00 — 22:00 ежедневно",
    phone: "+7 (926) 057-72-05",
  },
  {
    id: "store_nebo",
    name: "ТЦ «Небо»",
    address: "г. Москва, ул. Авиаторов, д. 3А",
    metro: "м. Солнцево",
    workHours: "10:00 — 22:00 ежедневно",
    phone: "+7 (926) 057-72-05",
  },
];

// ── Storefront API Client functions ──────────────────────────────────────────

/**
 * Searches cities from the Medusa CDEK endpoint.
 */
export async function searchCdekCities(query: string): Promise<CdekCity[]> {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return [];
  if (!isMedusaConfigured) unavailable();
  try {
    const data = await medusaRequest<unknown>(
      `/store/cdek/cities?query=${encodeURIComponent(trimmed)}`,
      { revalidate: 3600 },
    );
    return parseResponseList(data, "cities", parseCity);
  } catch (error) {
    if (error instanceof CdekDeliveryUnavailableError) throw error;
    unavailable();
  }
}

/**
 * Gets list of delivery points (PVZ, Postamats) for a city code.
 */
export async function fetchCdekDeliveryPoints(cityCode: number): Promise<CdekDeliveryPoint[]> {
  if (!Number.isInteger(cityCode) || cityCode <= 0 || !isMedusaConfigured) unavailable();
  try {
    const data = await medusaRequest<unknown>(
      `/store/cdek/pvz?city_code=${cityCode}`,
      { revalidate: 3600 },
    );
    return parseResponseList(data, "pvz", parseDeliveryPoint);
  } catch (error) {
    if (error instanceof CdekDeliveryUnavailableError) throw error;
    unavailable();
  }
}

/**
 * Gets Mario Mikke pickup retail stores in Moscow.
 */
export function getPickupStores(): PickupStore[] {
  return MARIO_MIKKE_PICKUP_STORES;
}
