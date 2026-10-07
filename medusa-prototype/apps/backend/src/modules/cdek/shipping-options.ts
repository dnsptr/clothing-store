import {
  CDEK_OPTION_PICKUP,
  CDEK_PROVIDER_CONFIG_ID,
  CDEK_PROVIDER_IDENTIFIER,
} from "./provider-id";

export const CDEK_FULFILLMENT_PROVIDER_ID =
  `${CDEK_PROVIDER_IDENTIFIER}_${CDEK_PROVIDER_CONFIG_ID}`;
export const MANUAL_FULFILLMENT_PROVIDER_ID = "manual_manual";

export type DeliveryProviderAvailability = {
  readonly cdekEnabled: boolean;
};

type DeliveryShippingOption = {
  readonly code: string;
  readonly name: string;
  readonly label: string;
  readonly description: string;
  readonly providerId: string;
};

const PICKUP_OPTION = {
  code: CDEK_OPTION_PICKUP,
  name: "Самовывоз из магазина (Москва, бесплатно)",
  label: "Самовывоз",
  description: "Бесплатный самовывоз из розничного магазина Mario Mikke в Москве.",
} as const;

// Carrier credentials establish API access, not a customer-facing shipping price.
// Until parcel dimensions and charge policy are approved, only free store pickup
// may be offered. Previously persisted carrier options are disabled by the importer.
export function resolveDeliveryShippingOptions(
  availability: DeliveryProviderAvailability,
): readonly DeliveryShippingOption[] {
  return [{
    ...PICKUP_OPTION,
    providerId: availability.cdekEnabled
      ? CDEK_FULFILLMENT_PROVIDER_ID
      : MANUAL_FULFILLMENT_PROVIDER_ID,
  }];
}
