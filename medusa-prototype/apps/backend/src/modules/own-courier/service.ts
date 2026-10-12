import { AbstractFulfillmentProviderService } from "@medusajs/framework/utils";
import type {
  CalculatedShippingOptionPrice,
  CalculateShippingOptionPriceContext,
  CreateFulfillmentResult,
  FulfillmentOption,
  ValidateFulfillmentDataContext,
} from "@medusajs/types";
import type { OwnCourierOptions } from "./config";
import { ownCourierEligibility } from "./eligibility";
import { OWN_COURIER_OPTION, OWN_COURIER_PROVIDER_IDENTIFIER } from "./provider-id";

export class OwnCourierUnavailableError extends Error {
  readonly name = "OwnCourierUnavailableError";
  constructor() { super("Own courier is unavailable for this destination"); }
}

export class UnsupportedOwnCourierCancellationError extends Error {
  readonly name = "UnsupportedOwnCourierCancellationError";
  constructor() { super("Own courier cancellation is not supported"); }
}

export default class OwnCourierFulfillmentProviderService extends AbstractFulfillmentProviderService {
  static identifier = OWN_COURIER_PROVIDER_IDENTIFIER;

  constructor(_container: unknown, private readonly options: OwnCourierOptions) {
    super();
  }

  async getFulfillmentOptions(): Promise<FulfillmentOption[]> {
    return [{ id: OWN_COURIER_OPTION }];
  }

  async validateOption(data: Record<string, unknown>): Promise<boolean> {
    return data["id"] === OWN_COURIER_OPTION;
  }

  async canCalculate(): Promise<boolean> { return true; }

  async calculatePrice(
    optionData: Record<string, unknown>,
    _data: Record<string, unknown>,
    context: CalculateShippingOptionPriceContext,
  ): Promise<CalculatedShippingOptionPrice> {
    if (optionData["id"] !== OWN_COURIER_OPTION) throw new OwnCourierUnavailableError();
    const eligible = await ownCourierEligibility(context.shipping_address, this.options);
    if (!eligible.eligible) throw new OwnCourierUnavailableError();
    return { calculated_amount: 0, is_calculated_price_tax_inclusive: true };
  }

  async validateFulfillmentData(
    optionData: Record<string, unknown>,
    _data: Record<string, unknown>,
    context: ValidateFulfillmentDataContext,
  ): Promise<Record<string, unknown>> {
    if (optionData["id"] !== OWN_COURIER_OPTION) throw new OwnCourierUnavailableError();
    const eligible = await ownCourierEligibility(context.shipping_address, this.options);
    if (!eligible.eligible) throw new OwnCourierUnavailableError();
    return { delivery_mode: OWN_COURIER_OPTION, verified_address: eligible.normalizedAddress };
  }

  async createFulfillment(
    data: Record<string, unknown>,
    _items: unknown[],
    _order: Record<string, unknown> | undefined,
    _fulfillment: Record<string, unknown>,
  ): Promise<CreateFulfillmentResult> {
    if (data["delivery_mode"] !== OWN_COURIER_OPTION ||
      typeof data["verified_address"] !== "string" || !data["verified_address"].trim()) {
      throw new OwnCourierUnavailableError();
    }
    return {
      data: {
        delivery_mode: OWN_COURIER_OPTION,
        verified_address: data["verified_address"],
        courier_status: "pending_assignment",
      },
      labels: [],
    };
  }

  async cancelFulfillment(_fulfillment: Record<string, unknown>): Promise<void> {
    throw new UnsupportedOwnCourierCancellationError();
  }
}
