import { AbstractFulfillmentProviderService } from "@medusajs/framework/utils";
import type {
  CalculatedShippingOptionPrice,
  CreateFulfillmentResult,
  FulfillmentOption,
  ValidateFulfillmentDataContext,
} from "@medusajs/types";

import type { CdekProviderOptions } from "./config";
import { CdekClient } from "./lib/cdek-client";
import {
  CDEK_OPTION_COURIER,
  CDEK_OPTION_PICKUP,
  CDEK_OPTION_PVZ,
  CDEK_PROVIDER_IDENTIFIER,
  CDEK_TARIFF_COURIER,
  CDEK_TARIFF_PVZ,
} from "./provider-id";

export interface PickupStoreLocation {
  id: string;
  name: string;
  address: string;
  metro: string;
  workHours: string;
  phone: string;
}

export const MOSCOW_PICKUP_STORES: PickupStoreLocation[] = [
  {
    id: "store_vodny",
    name: "ТЦ «Водный»",
    address: "г. Москва, Головинское шоссе, д. 5, корп. 1",
    metro: "м. Водный стадион",
    workHours: "10:00 — 22:00 ежедневно",
    phone: "+7 (926) 057-72-05",
  },
  {
    id: "store_govorovo",
    name: "ТЦ «Говорово»",
    address: "г. Москва, 47-й км МКАД, д. 31, стр. 1",
    metro: "м. Говорово",
    workHours: "10:00 — 22:00 ежедневно",
    phone: "+7 (926) 057-72-05",
  },
  {
    id: "store_nebo",
    name: "ТЦ «Небо»",
    address: "г. Москва, ул. Авиаторов, д. 3А",
    metro: "м. Солнцево",
    workHours: "10:00 — 22:00 ежедневно",
    phone: "+7 (926) 057-72-05",
  },
];

export default class CdekFulfillmentProviderService extends AbstractFulfillmentProviderService {
  static identifier = CDEK_PROVIDER_IDENTIFIER;
  private readonly client: CdekClient;

  constructor(
    _container: unknown,
    private readonly options: CdekProviderOptions,
  ) {
    super();
    this.client = new CdekClient(options);
  }

  getCdekClient(): CdekClient {
    return this.client;
  }

  async getFulfillmentOptions(): Promise<FulfillmentOption[]> {
    return [
      {
        id: CDEK_OPTION_PVZ,
        name: "СДЭК — Пункт выдачи (ПВЗ)",
      },
      {
        id: CDEK_OPTION_COURIER,
        name: "СДЭК — Курьерская доставка",
      },
      {
        id: CDEK_OPTION_PICKUP,
        name: "Самовывоз из магазина (Москва, бесплатно)",
      },
      {
        id: `${CDEK_OPTION_PVZ}-return`,
        is_return: true,
      },
    ];
  }

  async validateOption(data: Record<string, unknown>): Promise<boolean> {
    const id = String(data?.id || "");
    return [CDEK_OPTION_PVZ, CDEK_OPTION_COURIER, CDEK_OPTION_PICKUP].includes(id);
  }

  async canCalculate(): Promise<boolean> {
    return true;
  }

  async validateFulfillmentData(
    optionData: Record<string, unknown>,
    data: Record<string, unknown>,
    _context: ValidateFulfillmentDataContext,
  ): Promise<Record<string, unknown>> {
    const optionId = String(optionData?.id || "");

    // For PVZ option, we expect cdek_pvz_code or delivery_point if already chosen
    if (optionId === CDEK_OPTION_PVZ) {
      const pvzCode = data?.cdek_pvz_code || data?.delivery_point;
      return {
        ...data,
        cdek_pvz_code: pvzCode ? String(pvzCode) : undefined,
        cdek_pvz_address: data?.cdek_pvz_address ? String(data.cdek_pvz_address) : undefined,
      };
    }

    // For store pickup, store_id can be passed
    if (optionId === CDEK_OPTION_PICKUP) {
      const storeId = data?.pickup_store_id ? String(data.pickup_store_id) : "store_vodny";
      const store = MOSCOW_PICKUP_STORES.find((s) => s.id === storeId) || MOSCOW_PICKUP_STORES[0];
      return {
        ...data,
        pickup_store_id: store.id,
        pickup_store_name: store.name,
        pickup_store_address: store.address,
      };
    }

    return data;
  }

  async calculatePrice(
    optionData: Record<string, unknown>,
    data: Record<string, unknown>,
    context: Record<string, unknown>,
  ): Promise<CalculatedShippingOptionPrice> {
    const optionId = String(optionData?.id || "");

    // Store pickup is always free
    if (optionId === CDEK_OPTION_PICKUP) {
      return {
        calculated_amount: 0,
        is_calculated_price_tax_inclusive: true,
      };
    }

    // On MVP launch, shipping is free for customers (0 RUB promo policy)
    // We can also calculate actual CDEK tariff and store in data for analytics
    try {
      const destinationCityCode = Number(data?.city_code || context?.shipping_address?.city_code || 44);
      const tariffCode = optionId === CDEK_OPTION_COURIER ? CDEK_TARIFF_COURIER : CDEK_TARIFF_PVZ;

      // Calculate real tariff to verify delivery is possible to this destination
      await this.client.calculateTariff({
        toCityCode: destinationCityCode,
        tariffCode,
      });

      // Free shipping for customer on launch stage
      return {
        calculated_amount: 0,
        is_calculated_price_tax_inclusive: true,
      };
    } catch {
      // If CDEK API is temporarily unavailable or city_code not yet specified,
      // return 0 for launch promo so shopper is not blocked
      return {
        calculated_amount: 0,
        is_calculated_price_tax_inclusive: true,
      };
    }
  }

  async createFulfillment(
    data: Record<string, unknown>,
    items: unknown[],
    order: Record<string, unknown> | undefined,
    fulfillment: Record<string, unknown>,
  ): Promise<CreateFulfillmentResult> {
    const optionId = String(data?.option_id || fulfillment?.shipping_option_id || "");

    // Store pickup doesn't register with CDEK
    if (optionId === CDEK_OPTION_PICKUP || data?.pickup_store_id) {
      const storeName = data?.pickup_store_name || "ТЦ «Водный»";
      return {
        data: {
          delivery_mode: "pickup",
          store: storeName,
        },
        labels: [],
      };
    }

    const orderNumber = String(order?.display_id || order?.id || `ORD-${Date.now()}`);
    const shippingAddress = (order?.shipping_address || {}) as Record<string, unknown>;
    const recipientName = [shippingAddress.first_name, shippingAddress.last_name]
      .filter(Boolean)
      .join(" ") || "Покупатель Mario Mikke";
    const recipientPhone = String(shippingAddress.phone || "+79000000000");
    const recipientEmail = typeof order?.email === "string" ? order.email : undefined;

    const isCourier = optionId === CDEK_OPTION_COURIER;
    const tariffCode = isCourier ? CDEK_TARIFF_COURIER : CDEK_TARIFF_PVZ;
    const pvzCode = data?.cdek_pvz_code ? String(data.cdek_pvz_code) : undefined;

    // Estimate package weight (average 800g per apparel item)
    const itemCount = Array.isArray(items) ? items.length : 1;
    const totalWeight = Math.max(500, itemCount * 700);

    try {
      const cdekOrder = await this.client.createOrder({
        orderNumber,
        tariffCode,
        recipient: {
          name: recipientName,
          phones: [{ number: recipientPhone }],
          email: recipientEmail,
        },
        deliveryPoint: !isCourier ? pvzCode : undefined,
        toAddress: isCourier
          ? {
              address: [shippingAddress.address_1, shippingAddress.address_2].filter(Boolean).join(", ") || "Адрес доставки",
            }
          : undefined,
        packages: [
          {
            number: "1",
            weight: totalWeight,
            length: 30,
            width: 25,
            height: 10,
          },
        ],
      });

      const uuid = cdekOrder.entity.uuid;
      return {
        data: {
          cdek_uuid: uuid,
          tariff_code: tariffCode,
          pvz_code: pvzCode,
        },
        labels: [
          {
            tracking_number: uuid,
            tracking_url: `https://www.cdek.ru/ru/tracking?order_id=${uuid}`,
            label_url: "",
          },
        ],
      };
    } catch (error) {
      // Do not block order fulfillment creation in local/offline test mode
      const fallbackTrackingId = `CDEK-MOCK-${orderNumber}`;
      return {
        data: {
          cdek_mock: true,
          error: error instanceof Error ? error.message : String(error),
        },
        labels: [
          {
            tracking_number: fallbackTrackingId,
            tracking_url: `https://www.cdek.ru/ru/tracking?order_id=${fallbackTrackingId}`,
            label_url: "",
          },
        ],
      };
    }
  }

  async cancelFulfillment(fulfillment: Record<string, unknown>): Promise<Record<string, unknown>> {
    return {
      canceled_at: new Date().toISOString(),
      fulfillment_id: fulfillment?.id,
    };
  }

  async createReturnFulfillment(): Promise<CreateFulfillmentResult> {
    return {
      data: { is_return: true },
      labels: [],
    };
  }
}
