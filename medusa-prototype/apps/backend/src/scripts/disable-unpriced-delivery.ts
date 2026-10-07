import type { MedusaContainer } from "@medusajs/framework";
import { ContainerRegistrationKeys, ModuleRegistrationName } from "@medusajs/framework/utils";
import { CDEK_OPTION_PICKUP } from "../modules/cdek/provider-id";
import { shippingOptionIdsToDeactivate } from "../modules/cdek/shipping-options";

type ExecArgs = { container: MedusaContainer };

// This migration is safe to run in production: it never imports demo products,
// changes stock or creates a shipment. Keep checkout disabled until it completes.
export default async function disableUnpricedDelivery({ container }: ExecArgs) {
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const fulfillment = container.resolve(ModuleRegistrationName.FULFILLMENT);
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const { data: options } = await query.graph({
    entity: "shipping_option",
    fields: ["id", "name", "type.code"],
  });

  const ids = shippingOptionIdsToDeactivate(options);
  for (const id of ids) {
    await fulfillment.updateShippingOptions(id, {
      rules: [{ attribute: "enabled_in_store", value: "false", operator: "eq" }],
    });
  }
  logger.info(`Disabled ${ids.length} unpriced delivery options; verify their Store API visibility before enabling checkout.`);

  if (!options.some(option => option.type?.code === CDEK_OPTION_PICKUP)) {
    throw new Error("No existing pickup option: delivery options are disabled, but checkout must remain blocked until pickup is provisioned and verified.");
  }
}
