import type { MedusaContainer } from "@medusajs/framework";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { createShippingOptionsWorkflow } from "@medusajs/medusa/core-flows";
import { CDEK_OPTION_PICKUP } from "../modules/cdek/provider-id";
import { MANUAL_FULFILLMENT_PROVIDER_ID, resolveDeliveryShippingOptions } from "../modules/cdek/shipping-options";

type ExecArgs = { container: MedusaContainer };

// Existing server data already has a RU fulfillment set and manual provider, but
// may have only the legacy free MVP carrier. Never run the demo catalog importer
// to create pickup: it would also touch products and fabricated inventory.
export default async function ensurePickupDelivery({ container }: ExecArgs) {
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const pickup = resolveDeliveryShippingOptions({ cdekEnabled: false })[0];
  const [{ data: sets }, { data: profiles }, { data: locations }, { data: options }] = await Promise.all([
    query.graph({ entity: "fulfillment_set", fields: ["id", "name", "service_zones.id"] }),
    query.graph({ entity: "shipping_profile", fields: ["id", "name"] }),
    query.graph({ entity: "stock_location", fields: ["id", "name", "fulfillment_providers.id"] }),
    query.graph({ entity: "shipping_option", fields: [
      "id", "name", "price_type", "provider_id", "service_zone_id", "shipping_profile_id",
      "type.code", "rules.attribute", "rules.value", "prices.currency_code", "prices.amount",
    ] }),
  ]);
  const ruSets = sets.filter(set => set.name === "MVP Россия delivery");
  const defaultProfiles = profiles.filter(profile => profile.name === "Default Shipping Profile");
  const mainLocations = locations.filter(location => location.name === "Основной склад");
  if (ruSets.length !== 1 || ruSets[0].service_zones?.length !== 1 ||
      defaultProfiles.length !== 1 || mainLocations.length !== 1 ||
      !mainLocations[0].fulfillment_providers?.some(provider => provider?.id === MANUAL_FULFILLMENT_PROVIDER_ID)) {
    throw new Error("Pickup requires one RU service zone, default shipping profile and main location linked to the manual provider; review server configuration first.");
  }
  const zoneId = ruSets[0].service_zones[0].id;
  const profileId = defaultProfiles[0].id;
  const matches = options.filter(option => option.type?.code === CDEK_OPTION_PICKUP || option.name === pickup.name);
  if (matches.length) {
    const existing = matches[0];
    // Query Graph exposes linked prices and serialized rule values even though
    // the base ShippingOption type does not describe their projected shape.
    const { rules, prices } = existing as unknown as {
      rules?: { attribute: string; value: unknown }[];
      prices?: { currency_code: string; amount: unknown }[];
    };
    if (matches.length !== 1 || existing.type?.code !== CDEK_OPTION_PICKUP ||
        existing.price_type !== "flat" || existing.provider_id !== MANUAL_FULFILLMENT_PROVIDER_ID ||
        existing.service_zone_id !== zoneId || existing.shipping_profile_id !== profileId ||
        !rules?.some(rule => rule.attribute === "enabled_in_store" && rule.value === "true") ||
        rules?.some(rule => rule.attribute === "enabled_in_store" && rule.value !== "true") ||
        !rules?.some(rule => rule.attribute === "is_return" && rule.value === "false") ||
        !prices?.some(price => price.currency_code === "rub" && Number(price.amount) === 0) ||
        prices?.some(price => price.currency_code === "rub" && Number(price.amount) !== 0)) {
      throw new Error("Existing pickup option is ambiguous, disabled or incorrectly priced; review it manually before enabling checkout.");
    }
    logger.info(`Pickup already available: ${existing.id}. Legacy carrier options still require the delivery:disable-unpriced migration.`);
    return;
  }

  await createShippingOptionsWorkflow(container).run({ input: [{
    name: pickup.name,
    price_type: "flat",
    provider_id: MANUAL_FULFILLMENT_PROVIDER_ID,
    service_zone_id: zoneId,
    shipping_profile_id: profileId,
    type: { label: pickup.label, description: pickup.description, code: pickup.code },
    data: { id: pickup.code },
    prices: [{ currency_code: "rub", amount: 0 }],
    rules: [
      { attribute: "enabled_in_store", value: "true", operator: "eq" },
      { attribute: "is_return", value: "false", operator: "eq" },
    ],
  }] });
  logger.info("Manual store pickup created without importing catalog or inventory. Disable legacy unpriced delivery before checkout.");
}
