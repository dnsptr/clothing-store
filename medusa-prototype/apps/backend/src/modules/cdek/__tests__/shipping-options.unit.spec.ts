import {
  CDEK_FULFILLMENT_PROVIDER_ID,
  MANUAL_FULFILLMENT_PROVIDER_ID,
  resolveDeliveryShippingOptions,
  shippingOptionIdsToDeactivate,
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

  it("deactivates persisted free carrier and legacy shipping IDs on repeat import, not pickup", () => {
    expect(shippingOptionIdsToDeactivate([
      { id: "so_existing_cdek", name: "СДЭК", type: { code: "cdek-courier" } },
      { id: "so_existing_yandex", name: "Яндекс", type: { code: "yandex-pvz" } },
      { id: "so_existing_post", name: "Почта", type: { code: "pochta-parcel" } },
      { id: "so_existing_own", name: "Свой курьер", type: { code: "own-courier-mkad" } },
      { id: "so_existing_mvp", name: "MVP доставка по России" },
      { id: "so_existing_pickup", name: "Самовывоз", type: { code: "pickup-store" } },
      { id: "so_merchant_option", name: "Платная доставка", type: { code: "merchant-paid" } },
    ])).toEqual([
      "so_existing_cdek", "so_existing_yandex", "so_existing_post",
      "so_existing_own", "so_existing_mvp",
    ]);
  });
});
