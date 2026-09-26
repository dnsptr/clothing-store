import {
  CDEK_FULFILLMENT_PROVIDER_ID,
  MANUAL_FULFILLMENT_PROVIDER_ID,
  POCHTA_FULFILLMENT_PROVIDER_ID,
  OWN_COURIER_FULFILLMENT_PROVIDER_ID,
  YANDEX_FULFILLMENT_PROVIDER_ID,
  resolveDeliveryShippingOptions,
} from "../shipping-options";

describe("delivery shipping option provider binding", () => {
  it("creates only manual pickup when all delivery providers are disabled", () => {
    const options = resolveDeliveryShippingOptions({
      cdekEnabled: false,
      yandexEnabled: false,
      pochtaEnabled: false,
    });

    expect(options).toEqual([
      expect.objectContaining({
        code: "pickup-store",
        providerId: MANUAL_FULFILLMENT_PROVIDER_ID,
      }),
    ]);
  });

  it("creates CDEK delivery and provider-backed pickup when only CDEK is enabled", () => {
    const options = resolveDeliveryShippingOptions({
      cdekEnabled: true,
      yandexEnabled: false,
      pochtaEnabled: false,
    });

    expect(CDEK_FULFILLMENT_PROVIDER_ID).toBe("cdek_cdek");
    expect(options.map(({ code, providerId }) => ({ code, providerId }))).toEqual([
      { code: "cdek-pvz", providerId: CDEK_FULFILLMENT_PROVIDER_ID },
      { code: "cdek-courier", providerId: CDEK_FULFILLMENT_PROVIDER_ID },
      { code: "pickup-store", providerId: CDEK_FULFILLMENT_PROVIDER_ID },
    ]);
  });

  it("advertises Yandex Market PVZ only when the provider is enabled", () => {
    const options = resolveDeliveryShippingOptions({
      cdekEnabled: false,
      yandexEnabled: true,
      pochtaEnabled: false,
    });
    expect(options.map(({ code, providerId }) => ({ code, providerId }))).toEqual([
      { code: "pickup-store", providerId: MANUAL_FULFILLMENT_PROVIDER_ID },
      { code: "yandex-pvz", providerId: YANDEX_FULFILLMENT_PROVIDER_ID },
    ]);
    expect(YANDEX_FULFILLMENT_PROVIDER_ID).toBe("yandex-delivery_yandex-delivery");
  });

  it("creates parcel and courier options for the Pochta provider when only Pochta is enabled", () => {
    const options = resolveDeliveryShippingOptions({
      cdekEnabled: false,
      yandexEnabled: false,
      pochtaEnabled: true,
    });

    expect(POCHTA_FULFILLMENT_PROVIDER_ID).toBe("pochta_pochta");
    expect(options.map(({ code, providerId }) => ({ code, providerId }))).toEqual([
      { code: "pickup-store", providerId: MANUAL_FULFILLMENT_PROVIDER_ID },
      { code: "pochta-parcel", providerId: POCHTA_FULFILLMENT_PROVIDER_ID },
      { code: "pochta-courier", providerId: POCHTA_FULFILLMENT_PROVIDER_ID },
    ]);
  });

  it("creates every supported option with the matching provider when all are enabled", () => {
    const options = resolveDeliveryShippingOptions({
      cdekEnabled: true,
      yandexEnabled: true,
      pochtaEnabled: true,
    });

    expect(options.map(({ code, providerId }) => ({ code, providerId }))).toEqual([
      { code: "cdek-pvz", providerId: CDEK_FULFILLMENT_PROVIDER_ID },
      { code: "cdek-courier", providerId: CDEK_FULFILLMENT_PROVIDER_ID },
      { code: "pickup-store", providerId: CDEK_FULFILLMENT_PROVIDER_ID },
      { code: "yandex-pvz", providerId: YANDEX_FULFILLMENT_PROVIDER_ID },
      { code: "pochta-parcel", providerId: POCHTA_FULFILLMENT_PROVIDER_ID },
      { code: "pochta-courier", providerId: POCHTA_FULFILLMENT_PROVIDER_ID },
    ]);
  });

  it("advertises a distinct own-courier option only when DaData is configured", () => {
    const unavailable = resolveDeliveryShippingOptions({ cdekEnabled: false, yandexEnabled: false, pochtaEnabled: false, ownCourierEnabled: false });
    const configured = resolveDeliveryShippingOptions({ cdekEnabled: false, yandexEnabled: false, pochtaEnabled: false, ownCourierEnabled: true });
    expect(unavailable.map((item) => item.code)).not.toContain("own-courier-mkad");
    expect(configured).toContainEqual(expect.objectContaining({
      code: "own-courier-mkad", providerId: OWN_COURIER_FULFILLMENT_PROVIDER_ID,
    }));
    expect(OWN_COURIER_FULFILLMENT_PROVIDER_ID).toBe("own-courier_own-courier");
  });
});
