import {
  CDEK_OPTION_COURIER,
  CDEK_OPTION_PICKUP,
  CDEK_OPTION_PVZ,
  CDEK_PROVIDER_CONFIG_ID,
  CDEK_PROVIDER_IDENTIFIER,
} from "./provider-id";
import {
  POCHTA_OPTION_COURIER,
  POCHTA_OPTION_PARCEL,
  POCHTA_PROVIDER_CONFIG_ID,
  POCHTA_PROVIDER_IDENTIFIER,
} from "../pochta/provider-id";
import { OWN_COURIER_OPTION, OWN_COURIER_PROVIDER_CONFIG_ID, OWN_COURIER_PROVIDER_IDENTIFIER } from "../own-courier/provider-id";
import { YANDEX_DELIVERY_PROVIDER_CONFIG_ID, YANDEX_DELIVERY_PROVIDER_IDENTIFIER, YANDEX_OPTION_PVZ } from "../yandex-delivery/provider-id";

export const CDEK_FULFILLMENT_PROVIDER_ID =
  `${CDEK_PROVIDER_IDENTIFIER}_${CDEK_PROVIDER_CONFIG_ID}`;
export const POCHTA_FULFILLMENT_PROVIDER_ID =
  `${POCHTA_PROVIDER_IDENTIFIER}_${POCHTA_PROVIDER_CONFIG_ID}`;
export const YANDEX_FULFILLMENT_PROVIDER_ID =
  `${YANDEX_DELIVERY_PROVIDER_IDENTIFIER}_${YANDEX_DELIVERY_PROVIDER_CONFIG_ID}`;
export const MANUAL_FULFILLMENT_PROVIDER_ID = "manual_manual";
export const OWN_COURIER_FULFILLMENT_PROVIDER_ID =
  `${OWN_COURIER_PROVIDER_IDENTIFIER}_${OWN_COURIER_PROVIDER_CONFIG_ID}`;

export type DeliveryProviderAvailability = {
  readonly cdekEnabled: boolean;
  readonly yandexEnabled: boolean;
  readonly pochtaEnabled: boolean;
  readonly ownCourierEnabled?: boolean;
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

export function resolveDeliveryShippingOptions(
  availability: DeliveryProviderAvailability,
): readonly DeliveryShippingOption[] {
  return [
    ...(availability.cdekEnabled
      ? [
          {
            code: CDEK_OPTION_PVZ,
            name: "СДЭК — Доставка в пункт выдачи (ПВЗ)",
            label: "СДЭК ПВЗ",
            description: "Доставка до удобного пункта выдачи заказов СДЭК или постамата.",
            providerId: CDEK_FULFILLMENT_PROVIDER_ID,
          },
          {
            code: CDEK_OPTION_COURIER,
            name: "СДЭК — Курьерская доставка",
            label: "СДЭК Курьер",
            description: "Быстрая курьерская доставка СДЭК до двери.",
            providerId: CDEK_FULFILLMENT_PROVIDER_ID,
          },
        ]
      : []),
    {
      ...PICKUP_OPTION,
      providerId: availability.cdekEnabled
        ? CDEK_FULFILLMENT_PROVIDER_ID
        : MANUAL_FULFILLMENT_PROVIDER_ID,
    },
    ...(availability.yandexEnabled
      ? [{
          code: YANDEX_OPTION_PVZ,
          name: "Яндекс Маркет — Пункт выдачи или постамат",
          label: "Яндекс Маркет ПВЗ",
          description: "Доставка до выбранного пункта выдачи или постамата Яндекс Маркета.",
          providerId: YANDEX_FULFILLMENT_PROVIDER_ID,
        }]
      : []),
    ...(availability.ownCourierEnabled
      ? [{
          code: OWN_COURIER_OPTION,
          name: "Свой курьер — внутри МКАД",
          label: "Курьер по Москве",
          description: "Доставка своим курьером по проверенному адресу внутри МКАД.",
          providerId: OWN_COURIER_FULFILLMENT_PROVIDER_ID,
        }]
      : []),
    ...(availability.pochtaEnabled
      ? [
          {
            code: POCHTA_OPTION_PARCEL,
            name: "Почта России — Посылка в отделение",
            label: "Почта России",
            description: "Доставка посылки в выбранное отделение Почты России.",
            providerId: POCHTA_FULFILLMENT_PROVIDER_ID,
          },
          {
            code: POCHTA_OPTION_COURIER,
            name: "Почта России — Курьерская доставка",
            label: "Почта России Курьер",
            description: "Курьерская доставка Почты России до двери.",
            providerId: POCHTA_FULFILLMENT_PROVIDER_ID,
          },
        ]
      : []),
  ];
}
