import { MedusaContainer } from "@medusajs/framework";
import {
  ContainerRegistrationKeys,
  ModuleRegistrationName,
  Modules,
} from "@medusajs/framework/utils";
import {
  createApiKeysWorkflow,
  createRegionsWorkflow,
  createSalesChannelsWorkflow,
  createStockLocationsWorkflow,
  createStoresWorkflow,
  createTaxRegionsWorkflow,
  linkSalesChannelsToApiKeyWorkflow,
  linkSalesChannelsToStockLocationWorkflow,
  updateStoresWorkflow,
} from "@medusajs/medusa/core-flows";

// Mario Mikke sells only within Russia (currency RUB, УСН + НДС 5%). This seed
// provisions the RU-first commerce skeleton (sales channel, publishable API key,
// RUB store, Russia region, RU tax region, Moscow warehouse and RU fulfillment
// set). The real catalog, the store rename to "Mario Mikke" and the single RU
// shipping option ("MVP доставка по России") are created afterwards by
// src/scripts/import-mario-mikke.ts. Entity names/detection here are kept in sync
// with that import script so the sequence migrate -> seed -> import converges on a
// single set of RU entities without duplicates.
export default async function initial_data_seed({
  container,
}: {
  container: MedusaContainer;
}) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const link = container.resolve(ContainerRegistrationKeys.LINK);
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const fulfillmentModuleService = container.resolve(
    ModuleRegistrationName.FULFILLMENT
  );

  const countries = ["ru"];

  logger.info("Seeding store data...");
  const { data: existingSalesChannels } = await query.graph({
    entity: "sales_channel",
    fields: ["id", "name"],
  });
  let defaultSalesChannel: { id: string } | undefined =
    existingSalesChannels.find(
      (salesChannel) => salesChannel.name === "Default Sales Channel",
    );

  if (!defaultSalesChannel) {
    const {
      result: [createdSalesChannel],
    } = await createSalesChannelsWorkflow(container).run({
      input: {
        salesChannelsData: [
          {
            name: "Default Sales Channel",
            description: "Created by Medusa",
          },
        ],
      },
    });
    defaultSalesChannel = createdSalesChannel;
  }

  const { data: existingApiKeys } = await query.graph({
    entity: "api_key",
    fields: ["id", "title"],
  });
  let publishableApiKey: { id: string } | undefined = existingApiKeys.find(
    (apiKey) => apiKey.title === "Default Publishable API Key",
  );

  if (!publishableApiKey) {
    const {
      result: [createdApiKey],
    } = await createApiKeysWorkflow(container).run({
      input: {
        api_keys: [
          {
            title: "Default Publishable API Key",
            type: "publishable",
            created_by: "",
          },
        ],
      },
    });
    publishableApiKey = createdApiKey;

    await linkSalesChannelsToApiKeyWorkflow(container).run({
      input: {
        id: publishableApiKey.id,
        add: [defaultSalesChannel.id],
      },
    });
  }

  const { data: existingStores } = await query.graph({
    entity: "store",
    fields: ["id"],
  });
  const existingStore = existingStores[0];
  const storeInput = {
    name: "Default Store",
    supported_currencies: [
      {
        currency_code: "rub",
        is_default: true,
      },
    ],
    default_sales_channel_id: defaultSalesChannel.id,
  };

  if (existingStore) {
    await updateStoresWorkflow(container).run({
      input: {
        selector: { id: existingStore.id },
        update: storeInput,
      },
    });
  } else {
    await createStoresWorkflow(container).run({
      input: {
        stores: [storeInput],
      },
    });
  }

  logger.info("Seeding region data...");
  const { data: existingRegions } = await query.graph({
    entity: "region",
    fields: ["id", "name", "currency_code"],
  });
  // Detect the RU region by currency_code, matching import-mario-mikke.ts so both
  // scripts recognise the same single region (name "Россия", country "ru").
  const ruRegionExists = existingRegions.some(
    (existingRegion) => existingRegion.currency_code === "rub",
  );

  if (!ruRegionExists) {
    await createRegionsWorkflow(container).run({
      input: {
        regions: [
          {
            name: "Россия",
            currency_code: "rub",
            countries,
            payment_providers: ["pp_system_default"],
          },
        ],
      },
    });
  }
  logger.info("Finished seeding regions.");

  logger.info("Seeding tax regions...");
  const { data: existingTaxRegions } = await query.graph({
    entity: "tax_region",
    fields: ["id", "country_code"],
  });
  const taxRegionsToCreate = countries.filter(
    (country_code) =>
      !existingTaxRegions.some(
        (taxRegion) => taxRegion.country_code === country_code,
      ),
  );

  if (taxRegionsToCreate.length) {
    await createTaxRegionsWorkflow(container).run({
      input: taxRegionsToCreate.map((country_code) => ({
        country_code,
        provider_id: "tp_system",
      })),
    });
  }
  logger.info("Finished seeding tax regions.");

  logger.info("Seeding stock location data...");
  const { data: existingStockLocations } = await query.graph({
    entity: "stock_location",
    fields: ["id", "name"],
  });
  let stockLocation: { id: string } | undefined = existingStockLocations.find(
    (location) => location.name === "Основной склад",
  );
  const stockLocationExisted = Boolean(stockLocation);

  if (!stockLocation) {
    const { result: stockLocationResult } = await createStockLocationsWorkflow(
      container
    ).run({
      input: {
        locations: [
          {
            name: "Основной склад",
            address: {
              city: "Москва",
              country_code: "RU",
              address_1: "",
            },
          },
        ],
      },
    });
    stockLocation = stockLocationResult[0];

    await link.create({
      [Modules.STOCK_LOCATION]: {
        stock_location_id: stockLocation.id,
      },
      [Modules.FULFILLMENT]: {
        fulfillment_provider_id: "manual_manual",
      },
    });
  }

  logger.info("Seeding fulfillment data...");
  const { data: existingFulfillmentSets } = await query.graph({
    entity: "fulfillment_set",
    fields: ["id", "name", "service_zones.id"],
  });
  // Use the exact fulfillment set name that import-mario-mikke.ts looks for, so the
  // import reuses this set (and its service zone) instead of creating a duplicate.
  const existingFulfillmentSet = existingFulfillmentSets.find(
    (set) => set.name === "MVP Россия delivery"
  );
  let serviceZoneId = existingFulfillmentSet?.service_zones[0]?.id;

  if (!serviceZoneId) {
    const fulfillmentSet = await fulfillmentModuleService.createFulfillmentSets({
      name: "MVP Россия delivery",
      type: "shipping",
      service_zones: [
        {
          name: "Россия",
          geo_zones: [
            {
              country_code: "ru",
              type: "country",
            },
          ],
        },
      ],
    });
    serviceZoneId = fulfillmentSet.service_zones[0]?.id;

    await link.create({
      [Modules.STOCK_LOCATION]: {
        stock_location_id: stockLocation.id,
      },
      [Modules.FULFILLMENT]: {
        fulfillment_set_id: fulfillmentSet.id,
      },
    });
  }

  if (!serviceZoneId) {
    throw new Error("Russia fulfillment set has no service zone.");
  }

  // Shipping options are intentionally NOT seeded here. The single RU shipping
  // option ("MVP доставка по России", priced in RUB) is created idempotently by
  // src/scripts/import-mario-mikke.ts on this same service zone, keeping one
  // source of truth for shipping methods.
  logger.info("Finished seeding fulfillment data.");

  if (!stockLocationExisted) {
    await linkSalesChannelsToStockLocationWorkflow(container).run({
      input: {
        id: stockLocation.id,
        add: [defaultSalesChannel.id],
      },
    });
  }
  logger.info("Finished seeding stock location data.");
}
