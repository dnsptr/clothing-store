import { z } from "zod";

import type { CdekProviderOptions } from "../config";
import {
  CDEK_TARIFF_COURIER,
  CDEK_TARIFF_PVZ,
} from "../provider-id";
import {
  cityCodeSchema,
  citySchema,
  createOrderInputSchema,
  deliveryPointSchema,
  errorResponseSchema,
  identifierSchema,
  orderDetailsSchema,
  orderResponseSchema,
  packageSchema,
  supportedTariffCodeSchema,
  tariffResponseSchema,
  textSchema,
  tokenResponseSchema,
} from "./cdek-schemas";
import type {
  CdekCity,
  CdekDeliveryPoint,
  CdekOrderResponse,
  CdekPackage,
} from "./cdek-schemas";

export type {
  CdekCity,
  CdekDeliveryPoint,
  CdekOrderResponse,
  CdekPackage,
} from "./cdek-schemas";

export interface CdekTariffResult {
  tariff_code: number;
  tariff_name: string;
  delivery_sum: number;
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
  packages: Array<CdekPackage & { number: string }>;
  deliveryPoint?: string;
  toAddress?: { cityCode: number; address: string };
  comment?: string;
}

export interface CdekOrderDetails {
  uuid: string;
  cdek_number?: string;
  status: string;
  status_name?: string;
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

function parseCarrierResponse<T>(schema: z.ZodType<T>, payload: unknown, operation: string): T {
  const parsed = schema.safeParse(payload);
  if (!parsed.success) throw new CdekApiError(`CDEK ${operation} response is invalid`);
  return parsed.data;
}

function parseCarrierInput<T>(schema: z.ZodType<T>, value: unknown, operation: string): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new CdekApiError(`CDEK ${operation} request is invalid`);
  return parsed.data;
}

export class CdekClient {
  private cachedToken: string | null = null;
  private tokenExpiresAt = 0;
  private tokenPromise: Promise<string> | null = null;

  constructor(private readonly options: CdekProviderOptions) {}

  private async getAccessToken(): Promise<string> {
    if (this.cachedToken && Date.now() < this.tokenExpiresAt) return this.cachedToken;
    if (this.tokenPromise) return this.tokenPromise;

    this.tokenPromise = (async () => {
      try {
        const body = new URLSearchParams({
          grant_type: "client_credentials",
          client_id: this.options.clientId,
          client_secret: this.options.clientSecret,
        });
        const response = await fetch(`${this.options.apiBaseUrl}/oauth/token`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: body.toString(),
          signal: AbortSignal.timeout(15_000),
        });
        const payload = await this.readPayload(response, "OAuth");
        if (!response.ok) {
          throw new CdekApiError(`CDEK OAuth failed with HTTP ${response.status}`, response.status, payload);
        }
        const token = parseCarrierResponse(tokenResponseSchema, payload, "OAuth");
        this.cachedToken = token.access_token;
        this.tokenExpiresAt = Date.now() + Math.max(10, token.expires_in - 60) * 1_000;
        return this.cachedToken;
      } finally {
        this.tokenPromise = null;
      }
    })();
    return this.tokenPromise;
  }

  private async readPayload(response: Response, operation: string): Promise<unknown> {
    const text = await response.text();
    try {
      return text ? JSON.parse(text) : null;
    } catch {
      throw new CdekApiError(`CDEK ${operation} returned non-JSON HTTP ${response.status}`, response.status);
    }
  }

  private async request(endpoint: string, init: RequestInit = {}): Promise<unknown> {
    let token = await this.getAccessToken();
    const url = `${this.options.apiBaseUrl}${endpoint}`;
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${token}`);
    headers.set("Content-Type", "application/json");
    let response = await fetch(url, { ...init, headers, signal: AbortSignal.timeout(15_000) });
    if (response.status === 401) {
      this.cachedToken = null;
      this.tokenExpiresAt = 0;
      token = await this.getAccessToken();
      headers.set("Authorization", `Bearer ${token}`);
      response = await fetch(url, { ...init, headers, signal: AbortSignal.timeout(15_000) });
    }
    const payload = await this.readPayload(response, endpoint);
    if (!response.ok) {
      const error = errorResponseSchema.safeParse(payload);
      const message = error.success
        ? error.data.errors?.[0]?.message ?? error.data.message ?? "CDEK request failed"
        : "CDEK request failed";
      throw new CdekApiError(`CDEK request to ${endpoint} failed (${response.status}): ${message}`, response.status, payload);
    }
    return payload;
  }

  async searchCities(query: string, limit = 20): Promise<CdekCity[]> {
    const trimmed = query.trim();
    if (!trimmed) return [];
    const size = parseCarrierInput(z.number().int().positive().max(100), limit, "city search");
    const queryParams = new URLSearchParams({ city: trimmed, country_codes: "RU", size: String(size), lang: "rus" });
    return parseCarrierResponse(z.array(citySchema).max(1_000), await this.request(`/location/cities?${queryParams.toString()}`), "city search");
  }

  async getDeliveryPoints(cityCode: number, type?: "PVZ" | "POSTAMAT" | "ALL"): Promise<CdekDeliveryPoint[]> {
    const destinationCityCode = parseCarrierInput(cityCodeSchema, cityCode, "delivery point search");
    const params = new URLSearchParams({ city_code: String(destinationCityCode), is_handout: "true", lang: "rus" });
    if (type && type !== "ALL") params.set("type", type);
    return parseCarrierResponse(z.array(deliveryPointSchema).max(1_000), await this.request(`/deliverypoints?${params.toString()}`), "delivery point search");
  }

  async calculateTariff(params: { toCityCode: number; tariffCode: number; fromCityCode?: number; packages: CdekPackage[] }): Promise<CdekTariffResult> {
    const toCityCode = parseCarrierInput(cityCodeSchema, params.toCityCode, "tariff");
    const fromCityCode = parseCarrierInput(cityCodeSchema, params.fromCityCode ?? this.options.fromCityCode, "tariff");
    const tariffCode = parseCarrierInput(supportedTariffCodeSchema, params.tariffCode, "tariff");
    const packages = parseCarrierInput(z.array(packageSchema).min(1).max(100), params.packages, "tariff");
    const now = new Date(Date.now() + 3 * 60 * 60 * 1_000);
    const pad = (value: number) => String(value).padStart(2, "0");
    const date = `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())}T${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())}:${pad(now.getUTCSeconds())}+0300`;
    const response = parseCarrierResponse(tariffResponseSchema, await this.request("/calculator/tariff", {
      method: "POST",
      body: JSON.stringify({ date, type: 1, currency: 1, lang: "rus", tariff_code: tariffCode, from_location: { code: fromCityCode }, to_location: { code: toCityCode }, packages }),
    }), "tariff");
    const tariffName = tariffCode === CDEK_TARIFF_PVZ
      ? "СДЭК — Доставка в пункт выдачи (ПВЗ)"
      : "СДЭК — Курьерская доставка до двери";
    return { tariff_code: tariffCode, tariff_name: tariffName, delivery_sum: response.delivery_sum, period_min: response.period_min, period_max: response.period_max, delivery_date_min: response.delivery_date_range?.min, delivery_date_max: response.delivery_date_range?.max };
  }

  async createOrder(params: CdekOrderParams): Promise<CdekOrderResponse> {
    const order = parseCarrierInput(createOrderInputSchema, params, "order creation");
    const response = parseCarrierResponse(orderResponseSchema, await this.request("/orders", {
      method: "POST",
      body: JSON.stringify({
        type: 1,
        number: order.orderNumber,
        tariff_code: order.tariffCode,
        sender: { name: "ИП Заманов Рауф Рафикович" },
        recipient: order.recipient,
        packages: order.packages,
        ...(order.deliveryPoint ? { delivery_point: order.deliveryPoint } : {}),
        ...(order.toAddress ? { to_location: { code: order.toAddress.cityCode, address: order.toAddress.address } } : {}),
        ...(order.comment ? { comment: order.comment } : {}),
      }),
    }), "order creation");
    const rejectedRequest = response.requests.find((request) => request.state !== "ACCEPTED");
    const acceptedRequest = response.requests.some((request) => request.state === "ACCEPTED");
    if (!acceptedRequest || rejectedRequest) {
      throw new CdekApiError(`CDEK rejected order creation${rejectedRequest ? `: ${rejectedRequest.state}` : ""}`, undefined, response);
    }
    return response;
  }

  async getOrder(uuid: string): Promise<CdekOrderDetails> {
    const orderUuid = parseCarrierInput(identifierSchema, uuid, "order status");
    const response = parseCarrierResponse(orderDetailsSchema, await this.request(`/orders/${orderUuid}`), "order status");
    const latestStatus = response.entity.statuses.at(-1);
    if (!latestStatus) throw new CdekApiError("CDEK order status response is invalid");
    return { uuid: response.entity.uuid, cdek_number: response.entity.cdek_number, status: latestStatus.code, status_name: latestStatus.name };
  }
}
