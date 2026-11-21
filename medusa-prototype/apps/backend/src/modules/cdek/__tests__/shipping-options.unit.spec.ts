import {
  CDEK_FULFILLMENT_PROVIDER_ID,
  MANUAL_FULFILLMENT_PROVIDER_ID,
  OWN_COURIER_FULFILLMENT_PROVIDER_ID,
  YANDEX_FULFILLMENT_PROVIDER_ID,
  resolveDeliveryShippingOptions,
} from "../shipping-options";

describe("delivery shipping option provider binding", () => {
  it("creates only manual pickup when all delivery providers are disabled", () => {
    const options = resolveDeliveryShippingOptions({
      cdekEnabled: false,
      yandexEnabled: false,
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
    });
    expect(options.map(({ code, providerId }) => ({ code, providerId }))).toEqual([
      { code: "pickup-store", providerId: MANUAL_FULFILLMENT_PROVIDER_ID },
      { code: "yandex-pvz", providerId: YANDEX_FULFILLMENT_PROVIDER_ID },
    ]);
    expect(YANDEX_FULFILLMENT_PROVIDER_ID).toBe("yandex-delivery_yandex-delivery");
  });

  it("never advertises Russian Post among supported delivery options", () => {
    const options = resolveDeliveryShippingOptions({
      cdekEnabled: true,
      yandexEnabled: true,
      ownCourierEnabled: true,
    });
    expect(options.some(({ code, providerId }) =>
      code.startsWith("pochta") || providerId.startsWith("pochta"))).toBe(false);
  });

  it("creates every supported option with the matching provider when all are enabled", () => {
    const options = resolveDeliveryShippingOptions({
      cdekEnabled: true,
      yandexEnabled: true,
    });

    expect(options.map(({ code, providerId }) => ({ code, providerId }))).toEqual([
      { code: "cdek-pvz", providerId: CDEK_FULFILLMENT_PROVIDER_ID },
      { code: "cdek-courier", providerId: CDEK_FULFILLMENT_PROVIDER_ID },
      { code: "pickup-store", providerId: CDEK_FULFILLMENT_PROVIDER_ID },
      { code: "yandex-pvz", providerId: YANDEX_FULFILLMENT_PROVIDER_ID },
    ]);
  });

  it("advertises a distinct own-courier option only when DaData is configured", () => {
    const unavailable = resolveDeliveryShippingOptions({ cdekEnabled: false, yandexEnabled: false, ownCourierEnabled: false });
    const configured = resolveDeliveryShippingOptions({ cdekEnabled: false, yandexEnabled: false, ownCourierEnabled: true });
    expect(unavailable.map((item) => item.code)).not.toContain("own-courier-mkad");
    expect(configured).toContainEqual(expect.objectContaining({
      code: "own-courier-mkad", providerId: OWN_COURIER_FULFILLMENT_PROVIDER_ID,
    }));
    expect(OWN_COURIER_FULFILLMENT_PROVIDER_ID).toBe("own-courier_own-courier");
  });
});
