import { isMedusaConfigured, medusaRequest } from "./medusa";

export interface YandexCity {
  readonly geo_id: number;
  readonly city: string;
}

export interface YandexDeliveryPoint {
  readonly id: string;
  readonly name: string;
  readonly type: "pickup_point" | "terminal";
  readonly location: {
    readonly address: string;
    readonly city: string;
    readonly latitude?: number;
    readonly longitude?: number;
  };
  readonly instruction?: string;
  readonly phone?: string;
  readonly isFittingAllowed: boolean;
  readonly isPartialRefuseAllowed: boolean;
}

export class YandexDeliveryUnavailableError extends Error {
  readonly name = "YandexDeliveryUnavailableError";

  constructor(message: string = "Яндекс Доставка временно недоступна.") {
    super(message);
  }
}

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parsePoint(value: unknown): YandexDeliveryPoint {
  if (!isRecord(value) || typeof value.id !== "string" || !value.id.trim()) {
    throw new YandexDeliveryUnavailableError("Некорректный идентификатор пункта выдачи.");
  }
  if (typeof value.name !== "string" || !value.name.trim()) {
    throw new YandexDeliveryUnavailableError("Некорректное название пункта выдачи.");
  }
  const name = value.name.trim();
  const type = value.type === "terminal" ? ("terminal" as const) : ("pickup_point" as const);

  let address = "";
  let city = "";
  if (isRecord(value.address)) {
    if (typeof value.address.full_address === "string") address = value.address.full_address;
    if (typeof value.address.city === "string") city = value.address.city;
  }

  if (!address.trim()) {
    throw new YandexDeliveryUnavailableError("Некорректный адрес пункта выдачи.");
  }
  let latitude: number | undefined;
  let longitude: number | undefined;
  if (isRecord(value.position)) {
    if (typeof value.position.latitude === "number") latitude = value.position.latitude;
    if (typeof value.position.longitude === "number") longitude = value.position.longitude;
  }

  const instruction = typeof value.instruction === "string" ? value.instruction : undefined;
  const phone = typeof value.phone === "string" ? value.phone : undefined;
  const isFittingAllowed = value.isFittingAllowed === true;
  const isPartialRefuseAllowed = value.isPartialRefuseAllowed === true;

  return {
    id: value.id,
    name,
    type,
    location: {
      address,
      city,
      ...(latitude !== undefined ? { latitude } : {}),
      ...(longitude !== undefined ? { longitude } : {}),
    },
    ...(instruction ? { instruction } : {}),
    ...(phone ? { phone } : {}),
    isFittingAllowed,
    isPartialRefuseAllowed,
  };
}

/**
 * Searches cities/settlements in Yandex Delivery platform.
 */
export async function searchYandexCities(query: string): Promise<YandexCity[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];
  if (!isMedusaConfigured) throw new YandexDeliveryUnavailableError();
  try {
    const data = await medusaRequest<{ cities?: Array<{ geo_id: number; city: string }> }>(
      `/store/yandex/cities?query=${encodeURIComponent(trimmed)}`,
      { revalidate: 300 },
    );
    if (!data || !Array.isArray(data.cities)) return [];
    return data.cities;
  } catch (error) {
    if (error instanceof YandexDeliveryUnavailableError) throw error;
    throw new YandexDeliveryUnavailableError();
  }
}

/**
 * Retrieves delivery points (PVZ, Postamats) for a given city or geo_id.
 */
export async function fetchYandexDeliveryPoints(
  criteria: string | { city?: string; geo_id?: number },
): Promise<YandexDeliveryPoint[]> {
  if (!isMedusaConfigured) throw new YandexDeliveryUnavailableError();
  let queryParam = "";
  if (typeof criteria === "string") {
    const trimmed = criteria.trim();
    if (trimmed.length < 2) return [];
    queryParam = `city=${encodeURIComponent(trimmed)}`;
  } else if (criteria.geo_id !== undefined) {
    queryParam = `geo_id=${criteria.geo_id}`;
  } else if (criteria.city) {
    queryParam = `city=${encodeURIComponent(criteria.city.trim())}`;
  } else {
    return [];
  }

  try {
    const data = await medusaRequest<{ points?: unknown[] }>(
      `/store/yandex/pvz?${queryParam}`,
      { revalidate: 300 },
    );
    if (!data || !Array.isArray(data.points)) {
      throw new YandexDeliveryUnavailableError("ПВЗ не найдены.");
    }
    return data.points.map(parsePoint);
  } catch (error) {
    if (error instanceof YandexDeliveryUnavailableError) throw error;
    throw new YandexDeliveryUnavailableError();
  }
}
