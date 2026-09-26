import { z } from "zod";

import type { PochtaProviderOptions } from "../config";
import {
  backlogResponseSchema,
  packageSchema,
  postalIndexSchema,
  postOfficeSchema,
  tariffResponseSchema,
} from "../schemas";

export type PochtaPostOffice = z.infer<typeof postOfficeSchema>;

export type PochtaTariffResult = {
  readonly total_rate_rubles: number;
  readonly vat_rubles: number;
  readonly delivery_time_days_min: number;
  readonly delivery_time_days_max: number;
  readonly mail_type: "ONLINE_PARCEL" | "ONLINE_COURIER";
};

export type PochtaCalculateTariffParams = {
  readonly toIndex: string;
  readonly weightGrams: number;
  readonly lengthCm: number;
  readonly widthCm: number;
  readonly heightCm: number;
  readonly isCourier?: boolean;
};

export type PochtaOrderParams = PochtaCalculateTariffParams & {
  readonly orderNumber: string;
  readonly recipientAddress: string;
  readonly recipientName: string;
  readonly recipientPhone: string;
};

export class PochtaApiError extends Error {
  readonly name = "PochtaApiError";

  constructor(
    message: string,
    readonly status?: number,
    readonly data?: unknown,
  ) {
    super(message);
  }
}

export class PochtaClient {
  private readonly baseUrl: string;

  constructor(private readonly options: PochtaProviderOptions) {
    this.baseUrl = options.apiBaseUrl;
  }

  private async request(endpoint: string, init: RequestInit = {}): Promise<unknown> {
    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      ...init,
      headers: {
        Authorization: `AccessToken ${this.options.accessToken}`,
        "X-User-Authorization": `Basic ${this.options.userKey}`,
        "Content-Type": "application/json;charset=UTF-8",
      },
      signal: AbortSignal.timeout(10_000),
    });
    const text = await response.text();
    let payload: unknown;
    try {
      payload = text.length > 0 ? JSON.parse(text) : null;
    } catch {
      throw new PochtaApiError("Russian Post returned malformed JSON", response.status);
    }
    if (!response.ok) {
      throw new PochtaApiError("Russian Post rejected the request", response.status, payload);
    }
    return payload;
  }

  async calculateTariff(params: PochtaCalculateTariffParams): Promise<PochtaTariffResult> {
    const destination = postalIndexSchema.safeParse(params.toIndex);
    const parcel = packageSchema.safeParse({
      weightGrams: params.weightGrams,
      lengthCm: params.lengthCm,
      widthCm: params.widthCm,
      heightCm: params.heightCm,
    });
    if (!destination.success || !parcel.success) {
      throw new PochtaApiError("Invalid Russian Post tariff request");
    }
    const mailType = params.isCourier ? "ONLINE_COURIER" : "ONLINE_PARCEL";
    const payload = await this.request("/tariff", {
      method: "POST",
      body: JSON.stringify({
        "index-from": this.options.fromIndex,
        "index-to": destination.data,
        "mail-category": "ORDINARY",
        "mail-type": mailType,
        mass: parcel.data.weightGrams,
        dimension: {
          length: parcel.data.lengthCm,
          width: parcel.data.widthCm,
          height: parcel.data.heightCm,
        },
      }),
    });
    const parsed = tariffResponseSchema.safeParse(payload);
    if (!parsed.success) throw new PochtaApiError("Malformed Russian Post tariff response");
    return {
      total_rate_rubles: parsed.data["total-rate"] / 100,
      vat_rubles: parsed.data["total-vat"] / 100,
      delivery_time_days_min: parsed.data["delivery-time"]["min-days"],
      delivery_time_days_max: parsed.data["delivery-time"]["max-days"],
      mail_type: mailType,
    };
  }

  async getNearbyPostOffices(postalCode: string): Promise<PochtaPostOffice[]> {
    const destination = postalIndexSchema.safeParse(postalCode);
    if (!destination.success) throw new PochtaApiError("Invalid Russian Post postal index");
    const payload = await this.request(`/postoffice/1.0/${destination.data}`, { method: "GET" });
    const parsed = z.union([postOfficeSchema, z.array(postOfficeSchema).min(1)]).safeParse(payload);
    if (!parsed.success) throw new PochtaApiError("Malformed Russian Post post-office response");
    return Array.isArray(parsed.data) ? parsed.data : [parsed.data];
  }

  async createBacklogOrder(params: PochtaOrderParams): Promise<{ barcode: string; orderId: string }> {
    const destination = postalIndexSchema.safeParse(params.toIndex);
    const parcel = packageSchema.safeParse({
      weightGrams: params.weightGrams,
      lengthCm: params.lengthCm,
      widthCm: params.widthCm,
      heightCm: params.heightCm,
    });
    const identity = z.object({
      orderNumber: z.string().trim().min(1).max(200),
      recipientAddress: z.string().trim().min(1).max(500),
      recipientName: z.string().trim().min(1).max(200),
      recipientPhone: z.string().trim().regex(/^\+[1-9]\d{9,14}$/u),
    }).safeParse(params);
    if (!destination.success || !parcel.success || !identity.success) {
      throw new PochtaApiError("Invalid Russian Post backlog order");
    }
    const response = await this.request("/user/backlog", {
      method: "PUT",
      body: JSON.stringify([{
        "order-num": identity.data.orderNumber,
        "index-to": destination.data,
        "address-type-to": params.isCourier ? "MANUAL" : "POSTOFFICE",
        "address-to": identity.data.recipientAddress,
        "recipient-name": identity.data.recipientName,
        "tel-address": identity.data.recipientPhone,
        "mail-direct": 643,
        "mail-category": "ORDINARY",
        "mail-type": params.isCourier ? "ONLINE_COURIER" : "ONLINE_PARCEL",
        mass: parcel.data.weightGrams,
        dimension: {
          length: parcel.data.lengthCm,
          width: parcel.data.widthCm,
          height: parcel.data.heightCm,
        },
      }]),
    });
    const parsed = backlogResponseSchema.safeParse(response);
    if (!parsed.success) throw new PochtaApiError("Malformed Russian Post backlog response");
    const result = parsed.data.result["result-ids"][0];
    if (!result) throw new PochtaApiError("Empty Russian Post backlog response");
    return { barcode: result.barcode, orderId: String(result.id) };
  }
}
