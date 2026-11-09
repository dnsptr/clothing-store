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

export type YandexPlace = {
  readonly groupId: string;
  readonly unitIndex: number;
  readonly weightGrossGrams: number;
  readonly dxCm: number;
  readonly dyCm: number;
  readonly dzCm: number;
};

export type YandexPricingParams = {
  readonly sourceStationId: string;
  readonly destinationStationId: string;
  readonly places: readonly YandexPlace[];
  readonly assessedPriceRub: number;
};

export type YandexPricingResult = {
  readonly priceRub: number;
  readonly deliveryDays?: number;
  readonly currency: "RUB";
};

export type YandexOfferCreateParams = {
  readonly sourceStationId: string;
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
    readonly groupId: string;
    readonly unitIndex: number;
  }>;
  readonly places: readonly YandexPlace[];
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

function physicalDims(place: YandexPlace) {
  return {
    weight_gross: place.weightGrossGrams,
    dx: place.dxCm,
    dy: place.dyCm,
    dz: place.dzCm,
  };
}

function validatedPlaces(places: readonly YandexPlace[]) {
  if (!Array.isArray(places) || places.length < 1 || places.length > 100) {
    throw new YandexDeliveryApiError("Measured places are required");
  }
  const identities = new Map<string, YandexPlace>();
  let totalWeight = 0;
  for (const place of places) {
    if (!place || typeof place.groupId !== "string" || !/^[a-f0-9]{64}$/u.test(place.groupId) ||
      !Number.isInteger(place.unitIndex) ||
      place.unitIndex < 1 || place.unitIndex > 100 ||
      ![place.weightGrossGrams, place.dxCm, place.dyCm, place.dzCm]
        .every((value) => Number.isInteger(value) && value > 0) ||
      place.weightGrossGrams > 30_000 ||
      Math.max(place.dxCm, place.dyCm, place.dzCm) > 150 ||
      place.dxCm + place.dyCm + place.dzCm > 300) {
      throw new YandexDeliveryApiError("Invalid measured place");
    }
    const key = JSON.stringify([place.groupId, place.unitIndex]);
    if (identities.has(key)) throw new YandexDeliveryApiError("Duplicate measured place");
    identities.set(key, place);
    totalWeight += place.weightGrossGrams;
  }
  if (totalWeight > 200_000) throw new YandexDeliveryApiError("Order weight exceeds PVZ limit");
  return { identities, totalWeight };
}

function placeBarcode(orderId: string, place: Pick<YandexPlace, "groupId" | "unitIndex">) {
  return `MM-${createHash("sha256")
    .update(JSON.stringify([orderId, place.groupId, place.unitIndex]), "utf8")
    .digest("hex")}`;
}

export class YandexDeliveryClient {
  constructor(private readonly options: YandexDeliveryProviderOptions) {}

  private validateSourceStation(sourceStationId: string): void {
    if (typeof sourceStationId !== "string" || !sourceStationId.trim() ||
      sourceStationId.length > 200 || sourceStationId !== sourceStationId.trim()) {
      throw new YandexDeliveryApiError("An explicit source station is required");
    }
  }

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
    this.validateSourceStation(params.sourceStationId);
    const { places, assessedPriceRub } = params;
    const { totalWeight } = validatedPlaces(places);
    if (!Number.isFinite(assessedPriceRub) || assessedPriceRub <= 0 || assessedPriceRub > 100_000_000) {
      throw new YandexDeliveryApiError("Assessed price is required");
    }

    const response = await this.request("/pricing-calculator", {
      method: "POST",
      body: JSON.stringify({
        source: { platform_station_id: params.sourceStationId },
        destination: { platform_station_id: params.destinationStationId },
        tariff: "self_pickup",
        payment_method: "already_paid",
        total_weight: totalWeight,
        total_assessed_price: Math.round(assessedPriceRub * 100),
        places: places.map((place) => ({ physical_dims: physicalDims(place) })),
      }),
    });
    return parseUpstream(pricingCalculatorResponseSchema, response, "pricing calculator");
  }

  /**
   * Creates a delivery offer in Yandex Platform API.
   */
  async createOffer(params: YandexOfferCreateParams): Promise<{ offerId: string }> {
    this.validateSourceStation(params.sourceStationId);
    const orderDigest = createHash("sha256")
      .update(params.orderId, "utf8")
      .digest("base64url");
    const operatorRequestId = `req-pvz-${orderDigest}`;

    const { identities } = validatedPlaces(params.places);
    if (!Array.isArray(params.items) || params.items.length !== identities.size) {
      throw new YandexDeliveryApiError("Every place must contain one item");
    }
    let assessedPrice = 0;
    for (const item of params.items) {
      const key = JSON.stringify([item.groupId, item.unitIndex]);
      if (!identities.delete(key) || !Number.isFinite(item.unitPrice) || item.unitPrice < 0) {
        throw new YandexDeliveryApiError("Invalid item place or price");
      }
      assessedPrice += item.unitPrice;
    }
    if (!Number.isFinite(params.assessedPriceRub) || params.assessedPriceRub <= 0 ||
      params.assessedPriceRub > 100_000_000 ||
      Math.round(assessedPrice * 100) !== Math.round(params.assessedPriceRub * 100)) {
      throw new YandexDeliveryApiError("Assessed item price differs from order");
    }
    const placesByIdentity = new Map(params.places.map((place) =>
      [JSON.stringify([place.groupId, place.unitIndex]), place]));

    const response = await this.request("/offers/create", {
      method: "POST",
      body: JSON.stringify({
        info: {
          operator_request_id: operatorRequestId,
          comment: params.comment,
        },
        source: {
          platform_station: {
            platform_id: params.sourceStationId,
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
        places: params.places.map((place) => ({
          physical_dims: physicalDims(place),
          barcode: placeBarcode(params.orderId, place),
        })),
        items: params.items.map((item) => {
          const place = placesByIdentity.get(JSON.stringify([item.groupId, item.unitIndex]))!;
          return {
            count: 1,
            name: item.title,
            article: item.article,
            place_barcode: placeBarcode(params.orderId, item),
            billing_details: {
              unit_price: Math.round(item.unitPrice * 100),
              assessed_unit_price: Math.round(item.unitPrice * 100),
            },
            physical_dims: { dx: place.dxCm, dy: place.dyCm, dz: place.dzCm },
          };
        }),
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
