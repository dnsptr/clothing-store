import { AbstractFulfillmentProviderService, MedusaError } from "@medusajs/framework/utils";
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
  type HandoffOrigin,
} from "../../lib/carrier-handoff";

import type { CdekProviderOptions } from "./config";
import {
  CdekFulfillmentDataError,
  MOSCOW_PICKUP_STORES,
  buildCdekCartPackages,
  buildCdekPackages,
  buildCdekOrderPackages,
  cdekTariffPackages,
  parseCourierSelection,
  parseDeliveryMode,
  parseDestinationCityCode,
  parsePvzSelection,
  requireText,
  resolvePickupStore,
  validateCdekPackages,
  UnsupportedCdekCancellationError,
  UnsupportedCdekReturnError,
} from "./fulfillment-data";
import type { CdekPackageManifest } from "./fulfillment-data";
import { CdekClient } from "./lib/cdek-client";
import {
  CDEK_OPTION_COURIER,
  CDEK_OPTION_PICKUP,
  CDEK_OPTION_PVZ,
  CDEK_PROVIDER_IDENTIFIER,
  CDEK_TARIFF_COURIER,
  CDEK_TARIFF_PVZ,
} from "./provider-id";

export { MOSCOW_PICKUP_STORES } from "./fulfillment-data";
export type { PickupStoreLocation } from "./fulfillment-data";

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

  private async calculateCarrierQuote(
    optionId: typeof CDEK_OPTION_PVZ | typeof CDEK_OPTION_COURIER,
    data: Record<string, unknown>,
    origin: HandoffOrigin,
    packages: CdekPackageManifest,
  ) {
    if (origin.city_code === undefined) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "У пункта передачи СДЭК не указан код города.");
    }
    const toCityCode = parseDestinationCityCode(data["city_code"]);
    const points = await this.client.getReceptionPoints(origin.city_code, origin.id);
    if (!points.some((point) =>
      point.code === origin.id &&
      point.type === "PVZ" &&
      point.is_reception === true &&
      point.location.city_code === origin.city_code
    )) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Выбранный пункт СДЭК не принимает отправления или не соответствует городу отправки.",
      );
    }
    const quote = await this.client.calculateTariff({
      fromCityCode: origin.city_code,
      toCityCode,
      tariffCode: optionId === CDEK_OPTION_COURIER ? CDEK_TARIFF_COURIER : CDEK_TARIFF_PVZ,
      packages: cdekTariffPackages(packages),
    });
    return { packages, quote };
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
    context: ValidateFulfillmentDataContext,
  ): Promise<Record<string, unknown>> {
    const optionId = String(optionData?.id || "");

    if (optionId === CDEK_OPTION_PVZ) {
      const origin = selectHandoffPoint(context.from_location, "cdek");
      const selection = parsePvzSelection(data);
      const packages = buildCdekCartPackages(context["items"]);
      const points = await this.client.getDeliveryPoints(selection.city_code);
      const point = points.find(
        (candidate) =>
          candidate.code === selection.cdek_pvz_code &&
          candidate.location.city_code === selection.city_code,
      );
      if (!point) {
        throw new CdekFulfillmentDataError(
          `PVZ ${selection.cdek_pvz_code} is not available in city ${selection.city_code}`,
        );
      }
      const { quote } = await this.calculateCarrierQuote(CDEK_OPTION_PVZ, data, origin, packages);
      return {
        handoff_origin: origin,
        validated_packages: packages,
        delivery_mode: CDEK_OPTION_PVZ,
        city_code: selection.city_code,
        cdek_pvz_code: point.code,
        cdek_pvz_address: point.location.address,
        carrier_quote_amount: quote.delivery_sum,
        carrier_quote_currency: "RUB",
        carrier_quote_provider: "cdek",
        carrier_quote_tariff_code: quote.tariff_code,
      };
    }

    if (optionId === CDEK_OPTION_PICKUP) {
      const store = resolvePickupStore(data);
      return {
        delivery_mode: CDEK_OPTION_PICKUP,
        pickup_store_id: store.id,
        pickup_store_name: store.name,
        pickup_store_address: store.address,
      };
    }

    if (optionId === CDEK_OPTION_COURIER) {
      const selection = parseCourierSelection(data);
      const origin = selectHandoffPoint(context.from_location, "cdek");
      const packages = buildCdekCartPackages(context["items"]);
      const { quote } = await this.calculateCarrierQuote(CDEK_OPTION_COURIER, data, origin, packages);
      return {
        handoff_origin: origin,
        validated_packages: packages,
        delivery_mode: CDEK_OPTION_COURIER,
        city_code: selection.city_code,
        delivery_address: selection.delivery_address,
        carrier_quote_amount: quote.delivery_sum,
        carrier_quote_currency: "RUB",
        carrier_quote_provider: "cdek",
        carrier_quote_tariff_code: quote.tariff_code,
      };
    }

    throw new CdekFulfillmentDataError("option");
  }

  async calculatePrice(
    optionData: Record<string, unknown>,
    data: Record<string, unknown>,
    context: Record<string, unknown>,
  ): Promise<CalculatedShippingOptionPrice> {
    const optionId = String(optionData?.id || "");
    if (optionId === CDEK_OPTION_PICKUP) {
      return { calculated_amount: 0, is_calculated_price_tax_inclusive: true };
    }
    if (optionId !== CDEK_OPTION_PVZ && optionId !== CDEK_OPTION_COURIER) {
      throw new CdekFulfillmentDataError("option");
    }

    const origin = selectCheckoutHandoff(context.from_location, "cdek", data);
    await this.calculateCarrierQuote(optionId, data, origin, buildCdekCartPackages(context["items"]));
    return {
      calculated_amount: optionId === CDEK_OPTION_PVZ ? this.options.pvzPriceRub : this.options.courierPriceRub,
      is_calculated_price_tax_inclusive: true,
    };
  }

  async createFulfillment(
    data: Record<string, unknown>,
    items: unknown[],
    order: Record<string, unknown> | undefined,
    fulfillment: Record<string, unknown>,
    additionalData?: Record<string, unknown>,
  ): Promise<CreateFulfillmentResult> {
    const optionId = parseDeliveryMode(data);

    if (optionId === CDEK_OPTION_PICKUP) {
      const store = resolvePickupStore(data);
      return {
        data: {
          delivery_mode: "pickup",
          pickup_store_id: store.id,
          store: store.name,
          address: store.address,
        },
        labels: [],
      };
    }

    const origin = selectFulfillmentHandoff(fulfillment, "cdek", data, additionalData);
    const orderNumber = requireText(
      String(order?.display_id ?? order?.id ?? ""),
      "order identity",
    );
    const shippingAddress = (order?.shipping_address || {}) as Record<string, unknown>;
    const recipientName = [shippingAddress.first_name, shippingAddress.last_name]
      .filter(Boolean)
      .join(" ");
    requireText(recipientName, "recipient name");
    const recipientPhone = requireText(shippingAddress.phone, "recipient phone");
    const recipientEmail = typeof order?.email === "string" ? order.email : undefined;

    const isCourier = optionId === CDEK_OPTION_COURIER;
    const tariffCode = isCourier ? CDEK_TARIFF_COURIER : CDEK_TARIFF_PVZ;
    const pvzSelection = isCourier ? undefined : parsePvzSelection(data);
    const courierSelection = isCourier ? parseCourierSelection(data) : undefined;
    const toAddress = courierSelection
      ? {
          cityCode: courierSelection.city_code,
          address: courierSelection.delivery_address,
        }
      : undefined;

    const packages = buildCdekPackages(items, order);
    validateCdekPackages(data, packages);
    const orderPackages = buildCdekOrderPackages(packages, order);
    if (pvzSelection) {
      const points = await this.client.getDeliveryPoints(pvzSelection.city_code);
      if (!points.some((point) => point.code === pvzSelection.cdek_pvz_code &&
        point.location.city_code === pvzSelection.city_code)) {
        throw new CdekFulfillmentDataError("PVZ is no longer available");
      }
    }

    const { quote } = await this.calculateCarrierQuote(optionId, data, origin, packages);
    const cdekOrder = await this.client.createOrder({
      orderNumber,
      tariffCode,
      shipmentPoint: origin.id,
      recipient: {
        name: recipientName,
        phones: [{ number: recipientPhone }],
        email: recipientEmail,
      },
      deliveryPoint: pvzSelection?.cdek_pvz_code,
      toAddress,
      packages: orderPackages,
    });

    const uuid = cdekOrder.entity.uuid;
    return {
      data: {
        delivery_mode: optionId,
        handoff_origin: origin,
        carrier_quote_amount: quote.delivery_sum,
        carrier_quote_currency: "RUB",
        carrier_quote_provider: "cdek",
        carrier_quote_tariff_code: quote.tariff_code,
        cdek_uuid: uuid,
        tariff_code: tariffCode,
        pvz_code: pvzSelection?.cdek_pvz_code,
        validated_packages: packages,
      },
      // CDEK's asynchronous entity UUID is not a waybill number or label.
      labels: [],
    };
  }

  async cancelFulfillment(_fulfillment: Record<string, unknown>): Promise<Record<string, unknown>> {
    throw new UnsupportedCdekCancellationError();
  }

  async createReturnFulfillment(): Promise<CreateFulfillmentResult> {
    throw new UnsupportedCdekReturnError();
  }
}
