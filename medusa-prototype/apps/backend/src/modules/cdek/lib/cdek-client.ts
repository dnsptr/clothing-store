import type { CdekProviderOptions } from "../config";
import {
  CDEK_TARIFF_COURIER,
  CDEK_TARIFF_PVZ,
} from "../provider-id";

export interface CdekCity {
  code: number;
  city: string;
  region?: string;
  sub_region?: string;
  fias_guid?: string;
  kladr_code?: string;
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

export interface CdekPackage {
  weight: number; // in grams
  length?: number; // in cm
  width?: number; // in cm
  height?: number; // in cm
}

export interface CdekTariffResult {
  tariff_code: number;
  tariff_name: string;
  delivery_sum: number; // rubles
  period_min: number;
  period_max: number;
  delivery_date_min?: string;
  delivery_date_max?: string;
}

export interface CdekRecipient {
  name: string;
  phones: Array<{ number: string }>;
  email?: string;
}

export interface CdekOrderParams {
  orderNumber: string;
  tariffCode: number;
  recipient: CdekRecipient;
  packages: Array<{
    number: string;
    weight: number;
    length?: number;
    width?: number;
    height?: number;
    items?: Array<{
      name: string;
      ware_key: string;
      payment: { value: number };
      cost: number;
      weight: number;
      amount: number;
    }>;
  }>;
  deliveryPoint?: string; // PVZ code if tariff is PVZ/postamat
  toAddress?: {
    cityCode?: number;
    address: string;
  };
  comment?: string;
}

export interface CdekOrderResponse {
  entity: {
    uuid: string;
  };
  requests: Array<{
    request_uuid: string;
    type: string;
    state: string;
    date_time: string;
  }>;
}

export interface CdekOrderDetails {
  uuid: string;
  cdek_number?: string;
  status: string;
  status_name?: string;
  delivery_date?: string;
}

export class CdekApiError extends Error {
  readonly name = "CdekApiError";
  constructor(
    message: string,
    readonly status?: number,
    readonly errors?: unknown,
  ) {
    super(message);
  }
}

export class CdekClient {
  private cachedToken: string | null = null;
  private tokenExpiresAt: number = 0;

  constructor(private readonly options: CdekProviderOptions) {}

  private async getAccessToken(): Promise<string> {
    // If token exists and has more than 60 seconds left, reuse it
    if (this.cachedToken && Date.now() < this.tokenExpiresAt) {
      return this.cachedToken;
    }

    const tokenUrl = `${this.options.apiBaseUrl}/oauth/token`;
    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: this.options.clientId,
      client_secret: this.options.clientSecret,
    });

    const response = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new CdekApiError(`CDEK OAuth failed with HTTP ${response.status}: ${errText}`, response.status);
    }

    const payload = (await response.json()) as { access_token?: string; expires_in?: number };
    if (!payload.access_token) {
      throw new CdekApiError("CDEK OAuth response missing access_token");
    }

    this.cachedToken = payload.access_token;
    const expiresIn = typeof payload.expires_in === "number" ? payload.expires_in : 3600;
    // Cache until 60 seconds before expiration
    this.tokenExpiresAt = Date.now() + Math.max(10, expiresIn - 60) * 1000;

    return this.cachedToken;
  }

  private async request<T>(endpoint: string, init: RequestInit = {}): Promise<T> {
    let token = await this.getAccessToken();
    const url = `${this.options.apiBaseUrl}${endpoint}`;

    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers as Record<string, string>),
    };

    let response = await fetch(url, { ...init, headers, signal: AbortSignal.timeout(15_000) });

    // Handle token expiry / 401 retry
    if (response.status === 401) {
      this.cachedToken = null;
      this.tokenExpiresAt = 0;
      token = await this.getAccessToken();
      headers["Authorization"] = `Bearer ${token}`;
      response = await fetch(url, { ...init, headers, signal: AbortSignal.timeout(15_000) });
    }

    const text = await response.text();
    let data: unknown;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      throw new CdekApiError(`CDEK returned non-JSON HTTP ${response.status}`, response.status);
    }

    if (!response.ok) {
      const record = data as { errors?: Array<{ message: string; code: string }>; message?: string };
      const msg = record?.errors?.[0]?.message || record?.message || text;
      throw new CdekApiError(`CDEK request to ${endpoint} failed (${response.status}): ${msg}`, response.status, data);
    }

    return data as T;
  }

  /**
   * Search Russian cities by prefix/name.
   */
  async searchCities(query: string, limit = 20): Promise<CdekCity[]> {
    const trimmed = query.trim();
    if (!trimmed) return [];

    const queryParams = new URLSearchParams({
      city: trimmed,
      country_codes: "RU",
      size: String(limit),
      lang: "rus",
    });

    const list = await this.request<unknown>(`/location/cities?${queryParams.toString()}`);
    if (!Array.isArray(list)) return [];

    return list.map((item) => ({
      code: Number(item.code),
      city: String(item.city || ""),
      region: item.region ? String(item.region) : undefined,
      sub_region: item.sub_region ? String(item.sub_region) : undefined,
      fias_guid: item.fias_guid ? String(item.fias_guid) : undefined,
      kladr_code: item.kladr_code ? String(item.kladr_code) : undefined,
    }));
  }

  /**
   * Get PVZ / Postamat pickup points for a city code.
   */
  async getDeliveryPoints(cityCode: number, type?: "PVZ" | "POSTAMAT" | "ALL"): Promise<CdekDeliveryPoint[]> {
    const params = new URLSearchParams({
      city_code: String(cityCode),
      is_handout: "true",
      lang: "rus",
    });
    if (type && type !== "ALL") {
      params.set("type", type);
    }

    const list = await this.request<unknown>(`/deliverypoints?${params.toString()}`);
    if (!Array.isArray(list)) return [];

    return list.map((item) => ({
      code: String(item.code || ""),
      name: String(item.name || item.code || ""),
      type: item.type === "POSTAMAT" ? "POSTAMAT" : "PVZ",
      location: {
        address: String(item.location?.address || ""),
        address_full: item.location?.address_full ? String(item.location.address_full) : undefined,
        city_code: Number(item.location?.city_code || cityCode),
        city: String(item.location?.city || ""),
        latitude: typeof item.location?.latitude === "number" ? item.location.latitude : undefined,
        longitude: typeof item.location?.longitude === "number" ? item.location.longitude : undefined,
      },
      work_time: String(item.work_time || "Пн-Вс"),
      phones: Array.isArray(item.phones) ? item.phones : [],
      note: item.note ? String(item.note) : undefined,
      nearest_metro_station: item.nearest_metro_station ? String(item.nearest_metro_station) : undefined,
    }));
  }

  /**
   * Calculate tariff for a parcel between cities.
   */
  async calculateTariff(params: {
    toCityCode: number;
    tariffCode: number;
    fromCityCode?: number;
    packages?: CdekPackage[];
  }): Promise<CdekTariffResult> {
    const fromCode = params.fromCityCode || this.options.fromCityCode;
    const pkgs = params.packages && params.packages.length > 0
      ? params.packages
      : [{ weight: 1000, length: 25, width: 20, height: 10 }];

    // Format current date with timezone for CDEK v2 API: YYYY-MM-DDTHH:mm:ss+0300
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const dateStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}+0300`;

    const body = {
      date: dateStr,
      type: 1, // internet-store
      currency: 1, // RUB
      lang: "rus",
      tariff_code: params.tariffCode,
      from_location: { code: fromCode },
      to_location: { code: params.toCityCode },
      packages: pkgs,
    };

    const res = await this.request<{
      delivery_sum: number;
      period_min: number;
      period_max: number;
      calendar_min?: number;
      calendar_max?: number;
      delivery_date_range?: { min?: string; max?: string };
    }>("/calculator/tariff", {
      method: "POST",
      body: JSON.stringify(body),
    });

    const tariffName =
      params.tariffCode === CDEK_TARIFF_PVZ
        ? "СДЭК — Доставка в пункт выдачи (ПВЗ)"
        : params.tariffCode === CDEK_TARIFF_COURIER
          ? "СДЭК — Курьерская доставка до двери"
          : `СДЭК тариф ${params.tariffCode}`;

    return {
      tariff_code: params.tariffCode,
      tariff_name: tariffName,
      delivery_sum: res.delivery_sum,
      period_min: res.period_min,
      period_max: res.period_max,
      delivery_date_min: res.delivery_date_range?.min,
      delivery_date_max: res.delivery_date_range?.max,
    };
  }

  /**
   * Register order in CDEK.
   */
  async createOrder(params: CdekOrderParams): Promise<CdekOrderResponse> {
    const fromCode = this.options.fromCityCode;

    const payload: Record<string, unknown> = {
      type: 1, // ИМ (интернет-магазин)
      number: params.orderNumber,
      tariff_code: params.tariffCode,
      comment: params.comment || "Заказ Mario Mikke",
      sender: {
        name: "ИП Заманов Рауф Рафикович",
      },
      recipient: {
        name: params.recipient.name,
        phones: params.recipient.phones,
        email: params.recipient.email,
      },
      packages: params.packages,
    };

    // If PVZ mode, delivery_point is mandatory
    if (params.deliveryPoint) {
      payload.delivery_point = params.deliveryPoint;
    } else if (params.toAddress) {
      payload.to_location = {
        code: params.toAddress.cityCode,
        address: params.toAddress.address,
      };
    }

    return this.request<CdekOrderResponse>("/orders", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  /**
   * Get order status and tracking number.
   */
  async getOrder(uuid: string): Promise<CdekOrderDetails> {
    const res = await this.request<{
      entity: {
        uuid: string;
        cdek_number?: string;
        statuses?: Array<{ code: string; name: string; date_time: string }>;
      };
    }>(`/orders/${uuid}`);

    const latestStatus = res.entity.statuses?.[res.entity.statuses.length - 1];
    return {
      uuid: res.entity.uuid,
      cdek_number: res.entity.cdek_number,
      status: latestStatus?.code || "UNKNOWN",
      status_name: latestStatus?.name,
    };
  }
}
