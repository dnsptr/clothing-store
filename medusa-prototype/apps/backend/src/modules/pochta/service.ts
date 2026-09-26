import { AbstractFulfillmentProviderService } from "@medusajs/framework/utils";
import type {
  CalculatedShippingOptionPrice,
  CreateFulfillmentResult,
  FulfillmentOption,
  ValidateFulfillmentDataContext,
} from "@medusajs/types";

import type { PochtaProviderOptions } from "./config";
import {
  buildBacklogOrderParams,
  buildPochtaCartPackage,
  parsePochtaDeliveryMode,
  parsePochtaOption,
  UnsupportedPochtaCancellationError,
  validatePochtaSelection,
} from "./fulfillment-data";
import { PochtaClient } from "./lib/pochta-client";
import {
  POCHTA_OPTION_COURIER,
  POCHTA_OPTION_PARCEL,
  POCHTA_PROVIDER_IDENTIFIER,
} from "./provider-id";

export default class PochtaFulfillmentProviderService extends AbstractFulfillmentProviderService {
  static identifier = POCHTA_PROVIDER_IDENTIFIER;
  private readonly client: PochtaClient;

  constructor(_container: unknown, options: PochtaProviderOptions) {
    super();
    this.client = new PochtaClient(options);
  }

  getPochtaClient(): PochtaClient {
    return this.client;
  }

  private async calculateCarrierQuote(
    optionId: typeof POCHTA_OPTION_PARCEL | typeof POCHTA_OPTION_COURIER,
    data: Record<string, unknown>,
    context: Record<string, unknown>,
  ) {
    const selection = validatePochtaSelection(optionId, data);
    return this.client.calculateTariff({
      toIndex: selection.postal_code,
      ...buildPochtaCartPackage(context["items"]),
      isCourier: optionId === POCHTA_OPTION_COURIER,
    });
  }

  async getFulfillmentOptions(): Promise<FulfillmentOption[]> {
    return [
      { id: POCHTA_OPTION_PARCEL, name: "Почта России — Отделение (ОПС)" },
      { id: POCHTA_OPTION_COURIER, name: "Почта России — Курьер до двери" },
    ];
  }

  async validateOption(data: Record<string, unknown>): Promise<boolean> {
    return data["id"] === POCHTA_OPTION_PARCEL || data["id"] === POCHTA_OPTION_COURIER;
  }

  async canCalculate(): Promise<boolean> {
    return true;
  }

  async validateFulfillmentData(
    optionData: Record<string, unknown>,
    data: Record<string, unknown>,
    context: ValidateFulfillmentDataContext,
  ): Promise<Record<string, unknown>> {
    const optionId = parsePochtaOption(optionData["id"]);
    const selection = validatePochtaSelection(optionId, data);
    const quote = await this.calculateCarrierQuote(optionId, data, context);
    return {
      ...data,
      ...selection,
      delivery_mode: optionId,
      carrier_quote_amount: quote.total_rate_rubles,
      carrier_quote_currency: "RUB",
      carrier_quote_provider: "pochta",
    };
  }

  async calculatePrice(
    optionData: Record<string, unknown>,
    data: Record<string, unknown>,
    context: Record<string, unknown>,
  ): Promise<CalculatedShippingOptionPrice> {
    const optionId = parsePochtaOption(optionData["id"]);
    await this.calculateCarrierQuote(optionId, data, context);
    return { calculated_amount: 0, is_calculated_price_tax_inclusive: true };
  }

  async createFulfillment(
    data: Record<string, unknown>,
    items: unknown[],
    order: Record<string, unknown> | undefined,
    _fulfillment: Record<string, unknown>,
  ): Promise<CreateFulfillmentResult> {
    // Medusa's shipping_option_id is a generated `so_...` ID, not the provider option code.
    const mode = parsePochtaDeliveryMode(data);
    const isCourier = mode === POCHTA_OPTION_COURIER;
    const result = await this.client.createBacklogOrder(
      buildBacklogOrderParams(data, items, order, isCourier),
    );
    return {
      data: {
        ...data,
        delivery_mode: mode,
        pochta_barcode: result.barcode,
        pochta_order_id: result.orderId,
      },
      labels: [{
        tracking_number: result.barcode,
        tracking_url: `https://www.pochta.ru/tracking#${encodeURIComponent(result.barcode)}`,
        label_url: `https://otpravka.pochta.ru/forms/${encodeURIComponent(result.barcode)}/f7p.pdf`,
      }],
    };
  }

  async cancelFulfillment(_fulfillment: Record<string, unknown>): Promise<void> {
    throw new UnsupportedPochtaCancellationError();
  }
}
