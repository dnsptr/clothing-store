import {
  CDEK_FULFILLMENT_PROVIDER_ID,
  MANUAL_FULFILLMENT_PROVIDER_ID,
  resolveDeliveryShippingOptions,
} from "../shipping-options";

describe("delivery options without approved carrier pricing", () => {
  it("offers free manual store pickup when the carrier is not configured", () => {
    expect(resolveDeliveryShippingOptions({ cdekEnabled: false })).toEqual([
      expect.objectContaining({
        code: "pickup-store",
        providerId: MANUAL_FULFILLMENT_PROVIDER_ID,
      }),
    ]);
  });

  it("does not sell unpriced carriers despite configured credentials", () => {
    expect(resolveDeliveryShippingOptions({ cdekEnabled: true })).toEqual([
      expect.objectContaining({
        code: "pickup-store",
        providerId: CDEK_FULFILLMENT_PROVIDER_ID,
      }),
    ]);
  });
});
