import { AbstractFulfillmentProviderService } from "@medusajs/framework/utils";
import type {
  CalculatedShippingOptionPrice,
  CreateFulfillmentResult,
  FulfillmentOption,
  ValidateFulfillmentDataContext,
} from "@medusajs/types";

import {
  selectCheckoutHandoff,
  selectFulfillmentHandoff,
  selectHandoffPoint,
} from "../../lib/carrier-handoff";
import type { YandexDeliveryProviderOptions } from "./config";
import {
  buildCartPackages,
  buildOfferParams,
  buildPricingParams,
  confirmPvzSelection,
  requireRequestId,
  validatePvzSelection,
  YandexFulfillmentDataError,
} from "./fulfillment-data";
import { YandexDeliveryClient } from "./lib/yandex-client";
import {
  YANDEX_DELIVERY_PROVIDER_IDENTIFIER,
  YANDEX_OPTION_PVZ,
} from "./provider-id";

export default class YandexDeliveryFulfillmentProviderService extends AbstractFulfillmentProviderService {
  static identifier = YANDEX_DELIVERY_PROVIDER_IDENTIFIER;
  private readonly client: YandexDeliveryClient;
  private readonly pvzPriceRub: number;

  constructor(_container: unknown, options: YandexDeliveryProviderOptions) {
    super();
    this.client = new YandexDeliveryClient(options);
    this.pvzPriceRub = options.pvzPriceRub;
  }

  getYandexClient(): YandexDeliveryClient {
    return this.client;
  }

  async getFulfillmentOptions(): Promise<FulfillmentOption[]> {
    return [{ id: YANDEX_OPTION_PVZ, name: "Яндекс Маркет (ПВЗ и постаматы)" }];
  }

  async validateOption(data: Record<string, unknown>): Promise<boolean> {
    return data["id"] === YANDEX_OPTION_PVZ;
  }

  async canCalculate(): Promise<boolean> {
    return true;
  }

  async validateFulfillmentData(
    optionData: Record<string, unknown>,
    data: Record<string, unknown>,
    context: ValidateFulfillmentDataContext,
  ): Promise<Record<string, unknown>> {
    if (optionData["id"] !== YANDEX_OPTION_PVZ) throw new YandexFulfillmentDataError("option");
    const origin = selectHandoffPoint(context.from_location, "yandex");
    const selection = validatePvzSelection(data);
    const { manifest, places, assessedPriceRub } = buildCartPackages(context.items);
    const points = await this.client.getPickupPoints({ geo_id: selection.geo_id });
    const verified = confirmPvzSelection(data, points);
    const quote = await this.client.calculatePricing({
      sourceStationId: origin.id,
      destinationStationId: verified.platform_station_id, places, assessedPriceRub,
    });
    return {
      ...verified,
      handoff_origin: origin,
      package_manifest: manifest,
      carrier_quote_amount: quote.priceRub,
      carrier_quote_currency: quote.currency,
    };
  }

  async calculatePrice(
    optionData: Record<string, unknown>,
    data: Record<string, unknown>,
    context: Record<string, unknown>,
  ): Promise<CalculatedShippingOptionPrice> {
    if (optionData["id"] !== YANDEX_OPTION_PVZ) throw new YandexFulfillmentDataError("option");
    const selection = validatePvzSelection(data);
    const origin = selectCheckoutHandoff(context["from_location"], "yandex", data);
    const params = buildPricingParams(selection.platform_station_id, context["items"], origin.id);
    const points = await this.client.getPickupPoints({ geo_id: selection.geo_id });
    confirmPvzSelection(data, points);
    await this.client.calculatePricing(params);
    return { calculated_amount: this.pvzPriceRub, is_calculated_price_tax_inclusive: true };
  }

  async createFulfillment(
    data: Record<string, unknown>,
    items: unknown[],
    order: Record<string, unknown> | undefined,
    fulfillment: Record<string, unknown>,
    additionalData?: Record<string, unknown>,
  ): Promise<CreateFulfillmentResult> {
    // Medusa's shipping_option_id is a generated so_ ID, not the option's type.code.
    if (data["delivery_mode"] !== YANDEX_OPTION_PVZ) throw new YandexFulfillmentDataError("delivery mode");
    const origin = selectFulfillmentHandoff(fulfillment, "yandex", data, additionalData);
    const offerParams = buildOfferParams(data, items, order, origin.id);
    const selection = validatePvzSelection(data);
    const points = await this.client.getPickupPoints({ geo_id: selection.geo_id });
    confirmPvzSelection(data, points);
    const quote = await this.client.calculatePricing(offerParams);
    const orderResult = await this.client.createPvzOrder(offerParams);
    return {
      data: {
        ...data,
        handoff_origin: origin,
        carrier_quote_amount: quote.priceRub,
        carrier_quote_currency: quote.currency,
        yandex_request_id: orderResult.requestId,
        yandex_offer_id: orderResult.offerId,
        yandex_status: "created",
        delivery_mode: YANDEX_OPTION_PVZ,
      },
      labels: [],
    };
  }

  async cancelFulfillment(fulfillment: Record<string, unknown>): Promise<void> {
    await this.client.cancelRequest(requireRequestId(fulfillment));
  }
}
