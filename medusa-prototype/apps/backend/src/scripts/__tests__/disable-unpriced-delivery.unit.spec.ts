import disableUnpricedDelivery from "../disable-unpriced-delivery";
import { ContainerRegistrationKeys, ModuleRegistrationName } from "@medusajs/framework/utils";
import { CDEK_OPTION_PICKUP } from "../../modules/cdek/provider-id";

const options = [
  { id: "old_cdek", name: "CDEK", type: { code: "cdek-pvz" } },
  { id: "old_mvp", name: "MVP доставка по России", type: null },
  { id: "pickup", name: "Самовывоз", type: { code: CDEK_OPTION_PICKUP } },
];

function containerWith(shippingOptions: typeof options) {
  const updateShippingOptions = jest.fn().mockResolvedValue(undefined);
  const query = { graph: jest.fn().mockResolvedValue({ data: shippingOptions }) };
  const logger = { info: jest.fn() };
  const container = { resolve: (name: string) => {
    if (name === ContainerRegistrationKeys.QUERY) return query;
    if (name === ModuleRegistrationName.FULFILLMENT) return { updateShippingOptions };
    if (name === ContainerRegistrationKeys.LOGGER) return logger;
    throw new Error(`Unexpected dependency ${name}`);
  } };
  return { container, updateShippingOptions };
}

describe("production shipping-option migration", () => {
  it("disables persisted free carriers without mutating pickup", async () => {
    const { container, updateShippingOptions } = containerWith(options);
    await disableUnpricedDelivery({ container: container as never });
    expect(updateShippingOptions.mock.calls.map(([id]) => id)).toEqual(["old_cdek", "old_mvp"]);
    expect(updateShippingOptions.mock.calls.every(([, update]) =>
      update.rules.some((rule: { attribute: string; value: string }) => rule.attribute === "enabled_in_store" && rule.value === "false"),
    )).toBe(true);
  });

  it("disables unsafe methods but refuses launch if no pickup exists", async () => {
    const { container, updateShippingOptions } = containerWith(options.slice(0, 2));
    await expect(disableUnpricedDelivery({ container: container as never })).rejects.toThrow("No existing pickup option");
    expect(updateShippingOptions).toHaveBeenCalledTimes(2);
  });
});
