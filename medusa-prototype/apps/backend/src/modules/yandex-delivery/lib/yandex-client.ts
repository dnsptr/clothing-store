import { createHash } from "node:crypto";

import type { YandexDeliveryProviderOptions } from "../config";
import { OPERATOR_YANDEX_MARKET } from "../provider-id";
import {
  cancellationResponseSchema,
  locationDetectResponseSchema,
  offerConfirmResponseSchema,
  offerCreateResponseSchema,
  pickupPointsResponseSchema,
  pricingCalculatorResponseSchema,
  requestInfoResponseSchema,
} from "./upstream-schemas";

export type YandexPickupPoint = {
  readonly id: string;
  readonly name: string;
  readonly type: "pickup_point" | "terminal" | "warehouse";
  readonly operatorId?: string;
  readonly position: { readonly latitude: number; readonly longitude: number };
  readonly address: {
    readonly full_address: string;
    readonly city: string;
    readonly street?: string;
    readonly house?: string;
    readonly geo_id?: number;
    readonly postal_code?: string;
    readonly comment?: string;
  };
  readonly instruction?: string;
  readonly phone?: string;
  readonly isFittingAllowed: boolean;
  readonly isPartialRefuseAllowed: boolean;
};

export type YandexPricingParams = {
  readonly destinationStationId: string;
  readonly weightGrossGrams: number;
  readonly dxCm: number;
  readonly dyCm: number;
  readonly dzCm: number;
  readonly assessedPriceRub: number;
};

export type YandexPricingResult = {
  readonly priceRub: number;
  readonly deliveryDays?: number;
  readonly currency: "RUB";
};

export type YandexOfferCreateParams = {
  readonly orderId: string;
  readonly destinationStationId: string;
  readonly recipientFirstName: string;
  readonly recipientLastName?: string;
  readonly recipientPhone: string;
  readonly recipientEmail?: string;
  readonly comment?: string;
  readonly items: ReadonlyArray<{
    readonly title: string;
    readonly article: string;
    readonly unitPrice: number;
    readonly quantity: number;
    readonly dxCm: number;
    readonly dyCm: number;
    readonly dzCm: number;
  }>;
  readonly weightGrossGrams: number;
  readonly dxCm: number;
  readonly dyCm: number;
  readonly dzCm: number;
  readonly assessedPriceRub: number;
};
export class YandexDeliveryApiError extends Error {
  readonly name = "YandexDeliveryApiError";

  constructor(
    message: string,
    readonly status?: number,
    readonly data?: unknown,
  ) {
    super(message);
  }
}

function parseUpstream<T>(
  schema: { safeParse(value: unknown): { success: true; data: T } | { success: false; error: unknown } },
  value: unknown,
  operation: string,
): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new YandexDeliveryApiError(`Malformed Yandex Delivery ${operation} response`);
  }
  return result.data;
}

export type YandexDetectedLocation = { readonly geo_id: number; readonly address: string };

export class YandexDeliveryClient {
  constructor(private readonly options: YandexDeliveryProviderOptions) {}

  private async request(endpoint: string, init: RequestInit = {}): Promise<unknown> {
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${this.options.token}`);
    headers.set("Content-Type", "application/json");
    headers.set("Accept-Language", "ru");
    const response = await fetch(`${this.options.apiBaseUrl}${endpoint}`, {
      ...init,
      headers,
      signal: AbortSignal.timeout(10_000),
    });
    const text = await response.text();
    let data: unknown;
    try {
      data = text.length > 0 ? JSON.parse(text) : null;
    } catch {
      throw new YandexDeliveryApiError(
        `Yandex Delivery returned non-JSON response (HTTP ${response.status})`,
        response.status,
      );
    }
    if (!response.ok) {
      throw new YandexDeliveryApiError(
        `Yandex Delivery request failed with HTTP ${response.status}`,
        response.status,
        data,
      );
    }
    return data;
  }

  /**
   * Resolves a city or text query into geographic entities (geo_id).
   */
  async detectLocation(query: string): Promise<YandexDetectedLocation[]> {
    const trimmed = query.trim();
    if (!trimmed) return [];
    const response = await this.request("/location/detect", {
      method: "POST",
      body: JSON.stringify({ location: trimmed }),
    });
    return parseUpstream(locationDetectResponseSchema, response, "location detect").variants;
  }

  /**
   * Retrieves available pickup points (PVZ) and terminals.
   * If a string city name is passed, attempts to detect geo_id first.
   */
  async getPickupPoints(
    criteria: string | { geo_id?: number; type?: "pickup_point" | "terminal"; operator_ids?: string[] },
  ): Promise<YandexPickupPoint[]> {
    let geoId: number;
    let type: "pickup_point" | "terminal" | undefined;
    if (typeof criteria === "string") {
      const locations = await this.detectLocation(criteria);
      if (locations.length === 0) return [];
      geoId = locations[0].geo_id;
    } else {
      if (criteria.geo_id === undefined) throw new YandexDeliveryApiError("City geo ID is required");
      geoId = criteria.geo_id;
      type = criteria.type;
    }
    const payload: Record<string, unknown> = {
      geo_id: geoId,
      payment_method: "already_paid",
      operator_ids: [OPERATOR_YANDEX_MARKET],
    };
    if (type) payload.type = type;

    const response = await this.request("/pickup-points/list", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    return parseUpstream(pickupPointsResponseSchema, response, "pickup points").points
      .filter((point) => point.operatorId === OPERATOR_YANDEX_MARKET && point.type !== "warehouse");
  }

  /**
   * Calculates delivery price and transit time in days to a specific PVZ.
   */
  async calculatePricing(params: YandexPricingParams): Promise<YandexPricingResult> {
    const { weightGrossGrams, dxCm, dyCm, dzCm, assessedPriceRub } = params;
    if (![weightGrossGrams, dxCm, dyCm, dzCm, assessedPriceRub].every(Number.isFinite) ||
      weightGrossGrams <= 0 || dxCm <= 0 || dyCm <= 0 || dzCm <= 0 || assessedPriceRub <= 0) {
      throw new YandexDeliveryApiError("Measured parcel and assessed price are required");
    }

    const response = await this.request("/pricing-calculator", {
      method: "POST",
      body: JSON.stringify({
        source: { platform_station_id: this.options.sourceStationId },
        destination: { platform_station_id: params.destinationStationId },
        tariff: "self_pickup",
        payment_method: "already_paid",
        total_weight: weightGrossGrams,
        total_assessed_price: Math.round(assessedPriceRub * 100),
        places: [{
          physical_dims: {
            weight_gross: weightGrossGrams,
            dx: dxCm,
            dy: dyCm,
            dz: dzCm,
          },
        }],
      }),
    });
    return parseUpstream(pricingCalculatorResponseSchema, response, "pricing calculator");
  }

  /**
   * Creates a delivery offer in Yandex Platform API.
   */
  async createOffer(params: YandexOfferCreateParams): Promise<{ offerId: string }> {
    const orderDigest = createHash("sha256")
      .update(params.orderId, "utf8")
      .digest("base64url");
    const operatorRequestId = `req-pvz-${orderDigest}`;

    const { weightGrossGrams, dxCm, dyCm, dzCm } = params;
    if (![weightGrossGrams, dxCm, dyCm, dzCm].every(Number.isFinite) ||
      weightGrossGrams <= 0 || dxCm <= 0 || dyCm <= 0 || dzCm <= 0) {
      throw new YandexDeliveryApiError("Measured parcel is required");
    }

    const response = await this.request("/offers/create", {
      method: "POST",
      body: JSON.stringify({
        info: {
          operator_request_id: operatorRequestId,
          comment: params.comment,
        },
        source: {
          platform_station: {
            platform_id: this.options.sourceStationId,
          },
        },
        destination: {
          type: "platform_station",
          platform_station: {
            platform_id: params.destinationStationId,
          },
        },
        recipient_info: {
          first_name: params.recipientFirstName,
          last_name: params.recipientLastName,
          phone: params.recipientPhone,
          email: params.recipientEmail,
        },
        billing_info: {
          payment_method: "already_paid",
          delivery_cost: 0,
        },
        places: [
          {
            physical_dims: {
              weight_gross: weightGrossGrams,
              dx: dxCm,
              dy: dyCm,
              dz: dzCm,
            },
            barcode: `MM-${params.orderId}-1`,
          },
        ],
        items: params.items.map((item) => ({
          count: item.quantity,
          name: item.title,
          article: item.article,
          billing_details: {
            unit_price: Math.round(item.unitPrice * 100),
            assessed_unit_price: Math.round(item.unitPrice * 100),
          },
          physical_dims: {
            dx: item.dxCm,
            dy: item.dyCm,
            dz: item.dzCm,
          },
        })),
        last_mile_policy: "self_pickup",
      }),
    });
    const parsed = parseUpstream(offerCreateResponseSchema, response, "offer create");
    return { offerId: parsed.offer_id };
  }

  /**
   * Confirms a previously created delivery offer, placing the shipment request.
   */
  async confirmOffer(offerId: string): Promise<{ requestId: string }> {
    const response = await this.request("/offers/confirm", {
      method: "POST",
      body: JSON.stringify({ offer_id: offerId }),
    });
    const parsed = parseUpstream(offerConfirmResponseSchema, response, "offer confirm");
    return { requestId: parsed.request_id };
  }

  /**
   * Unified helper to create and confirm a PVZ fulfillment request.
   */
  async createPvzOrder(params: YandexOfferCreateParams): Promise<{ requestId: string; offerId: string }> {
    const { offerId } = await this.createOffer(params);
    const confirmed = await this.confirmOffer(offerId);
    return { requestId: confirmed.requestId, offerId };
  }

  /**
   * Retrieves request tracking information.
   */
  async getRequestInfo(requestId: string): Promise<{ requestId: string; status: string }> {
    const response = await this.request(`/request/info?request_id=${encodeURIComponent(requestId)}`, {
      method: "GET",
    });
    return parseUpstream(requestInfoResponseSchema, response, "request info");
  }

  /**
   * Cancels a previously booked delivery request.
   */
  async cancelRequest(requestId: string): Promise<void> {
    const response = await this.request("/request/cancel", {
      method: "POST",
      body: JSON.stringify({ request_id: requestId }),
    });
    const result = parseUpstream(cancellationResponseSchema, response, "request cancel");
    if (result.status === "ERROR" || (result.status !== "SUCCESS" && result.reason !== "already_cancelled")) {
      throw new YandexDeliveryApiError(`Yandex Delivery cancellation ${result.status.toLowerCase()}`);
    }
  }
}
