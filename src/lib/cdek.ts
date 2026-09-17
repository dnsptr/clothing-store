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

export interface CdekDeliveryEstimate {
  deliverySum: number;
  periodMin: number;
  periodMax: number;
  customerCost: number; // 0 on launch stage
  deliveryDateMin?: string;
  deliveryDateMax?: string;
}

// ── Fallback mock data for development, tests, and mock mode ───────────────

export const MOCK_CDEK_CITIES: CdekCity[] = [
  { code: 44, city: "Москва", region: "Москва" },
  { code: 137, city: "Санкт-Петербург", region: "Санкт-Петербург" },
  { code: 270, city: "Новосибирск", region: "Новосибирская область" },
  { code: 272, city: "Екатеринбург", region: "Свердловская область" },
  { code: 410, city: "Казань", region: "Республика Татарстан" },
  { code: 273, city: "Нижний Новгород", region: "Нижегородская область" },
  { code: 276, city: "Самара", region: "Самарская область" },
  { code: 274, city: "Ростов-на-Дону", region: "Ростовская область" },
  { code: 275, city: "Краснодар", region: "Краснодарский край" },
  { code: 277, city: "Воронеж", region: "Воронежская область" },
  { code: 290, city: "Сочи", region: "Краснодарский край" },
  { code: 284, city: "Уфа", region: "Республика Башкортостан" },
  { code: 283, city: "Тюмень", region: "Тюменская область" },
  { code: 298, city: "Владивосток", region: "Приморский край" },
];

export const MOCK_MOSCOW_PVZ: CdekDeliveryPoint[] = [
  {
    code: "MSK65",
    name: "ПВЗ Динамовская",
    type: "PVZ",
    location: {
      address: "ул. Динамовская, д. 1А",
      city_code: 44,
      city: "Москва",
      latitude: 55.7314,
      longitude: 37.6621,
    },
    work_time: "Пн-Пт 10:00-21:00, Сб-Вс 10:00-19:00",
    nearest_metro_station: "Пролетарская",
    note: "Вход с торца здания",
  },
  {
    code: "MSK12",
    name: "ПВЗ Тверская",
    type: "PVZ",
    location: {
      address: "ул. Тверская, д. 12, стр. 2",
      city_code: 44,
      city: "Москва",
      latitude: 55.7645,
      longitude: 37.6062,
    },
    work_time: "Пн-Вс 10:00-22:00",
    nearest_metro_station: "Пушкинская",
    note: "1 этаж, рядом с аптекой",
  },
  {
    code: "MSK88",
    name: "ПВЗ Ленинский",
    type: "PVZ",
    location: {
      address: "Ленинский пр-кт, д. 72",
      city_code: 44,
      city: "Москва",
      latitude: 55.6923,
      longitude: 37.5411,
    },
    work_time: "Пн-Вс 10:00-20:00",
    nearest_metro_station: "Университет",
  },
  {
    code: "MSK104",
    name: "Постамат Кутузовский",
    type: "POSTAMAT",
    location: {
      address: "Кутузовский пр-кт, д. 26",
      city_code: 44,
      city: "Москва",
      latitude: 55.7441,
      longitude: 37.5458,
    },
    work_time: "Круглосуточно 24/7",
    nearest_metro_station: "Кутузовская",
  },
];

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
    address: "г. Москва, 47-й км МКАД, д. 31, стр. 1",
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
 * Searches cities using CDEK API with instant mock fallback.
 */
export async function searchCdekCities(query: string): Promise<CdekCity[]> {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return [];

  if (isMedusaConfigured) {
    try {
      const data = await medusaRequest<{ cities?: CdekCity[] }>(
        `/store/cdek/cities?query=${encodeURIComponent(trimmed)}`,
        { revalidate: 3600 },
      );
      if (Array.isArray(data.cities) && data.cities.length > 0) {
        return data.cities;
      }
    } catch {
      // Fallback to offline search on network glitch
    }
  }

  return MOCK_CDEK_CITIES.filter(
    (c) =>
      c.city.toLowerCase().includes(trimmed) ||
      (c.region && c.region.toLowerCase().includes(trimmed)),
  );
}

/**
 * Gets list of delivery points (PVZ, Postamats) for a city code.
 */
export async function fetchCdekDeliveryPoints(cityCode: number): Promise<CdekDeliveryPoint[]> {
  if (!cityCode) return [];

  if (isMedusaConfigured) {
    try {
      const data = await medusaRequest<{ pvz?: CdekDeliveryPoint[] }>(
        `/store/cdek/pvz?city_code=${cityCode}`,
        { revalidate: 3600 },
      );
      if (Array.isArray(data.pvz) && data.pvz.length > 0) {
        return data.pvz;
      }
    } catch {
      // Fallback to mock PVZ on network glitch
    }
  }

  // If Moscow or any city in mock mode, return mock PVZ
  if (cityCode === 44 || cityCode <= 0) {
    return MOCK_MOSCOW_PVZ;
  }

  return [
    {
      code: `PVZ-${cityCode}-1`,
      name: "Центральный пункт выдачи СДЭК",
      type: "PVZ",
      location: {
        address: "ул. Ленина, д. 10",
        city_code: cityCode,
        city: "Город доставки",
      },
      work_time: "Пн-Вс 10:00-20:00",
      note: "Центральный офис",
    },
    {
      code: `PVZ-${cityCode}-2`,
      name: "Пункт выдачи СДЭК",
      type: "PVZ",
      location: {
        address: "пр-кт Мира, д. 25",
        city_code: cityCode,
        city: "Город доставки",
      },
      work_time: "Пн-Сб 10:00-19:00",
    },
  ];
}

/**
 * Gets Mario Mikke pickup retail stores in Moscow.
 */
export function getPickupStores(): PickupStore[] {
  return MARIO_MIKKE_PICKUP_STORES;
}

/**
 * Estimates delivery tariff and timeframe for a city code.
 */
export async function estimateCdekDelivery(
  cityCode: number,
  mode: "pvz" | "courier",
): Promise<CdekDeliveryEstimate> {
  const isMoscow = cityCode === 44;

  if (isMedusaConfigured) {
    try {
      const data = await medusaRequest<{
        pvz?: { delivery_sum: number; period_min: number; period_max: number };
        courier?: { delivery_sum: number; period_min: number; period_max: number };
        customer_cost?: number;
      }>("/store/cdek/calculate", {
        method: "POST",
        body: { to_city_code: cityCode },
      });

      const selected = mode === "courier" ? data.courier : data.pvz;
      if (selected) {
        return {
          deliverySum: selected.delivery_sum,
          periodMin: selected.period_min,
          periodMax: selected.period_max,
          customerCost: 0, // Free promo on launch
        };
      }
    } catch {
      // Fallback to estimated days
    }
  }

  // Realistic delivery timelines
  return {
    deliverySum: mode === "courier" ? 350 : 200,
    periodMin: isMoscow ? 1 : 2,
    periodMax: isMoscow ? 2 : 4,
    customerCost: 0,
  };
}
