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
  createTaxRatesWorkflow,
  createTaxRegionsWorkflow,
  linkSalesChannelsToApiKeyWorkflow,
  linkSalesChannelsToStockLocationWorkflow,
  updateStoresWorkflow,
} from "@medusajs/medusa/core-flows";

// Правило слияния валют магазина — единственная нетривиальная логика сида, и
// именно она подвела на учении по восстановлению БД 2026-07-27 (§3.1): сид
// передавал supported_currencies коротким списком «только рубль», а
// updateStoresWorkflow отдаёт этот список в upsertWithReplace, то есть ЗАМЕНЯЕТ
// его целиком. Повторный прогон по восстановленной чужой базе оставил в
// магазине одну валюту вместо трёх (eur и usd удалены).
//
// Правило теперь такое: чужие валюты переносим как есть вместе с их признаком
// «по умолчанию», рублём список только дополняем. Вынесено отдельной чистой
// функцией, чтобы правило проверялось юнит-тестом, а не только полным прогоном
// сида по живой базе.
export function mergeSupportedCurrencies(
  existingCurrencies: {
    currency_code: string;
    is_default?: boolean | null;
  }[],
): {
  currency_code: string;
  is_default: boolean;
  is_tax_inclusive?: boolean;
}[] {
  const supportedCurrencies = existingCurrencies.map((currency) => ({
    currency_code: currency.currency_code,
    is_default: Boolean(currency.is_default),
    // is_tax_inclusive проставляем только рублю — своей валюте. Для чужих валют
    // undefined означает «не менять»: updatePricePreferencesAsArrayStep резолвит
    // флаг как `is_tax_inclusive ?? prevEntry.is_tax_inclusive`.
    is_tax_inclusive: currency.currency_code === "rub" ? true : undefined,
  }));
  let rubCurrency = supportedCurrencies.find(
    (currency) => currency.currency_code === "rub",
  );

  if (!rubCurrency) {
    rubCurrency = {
      currency_code: "rub",
      is_default: false,
      is_tax_inclusive: true,
    };
    supportedCurrencies.push(rubCurrency);
  }

  // Магазин обязан иметь ровно одну валюту по умолчанию: без неё
  // validateUpdateRequest роняет весь `db:migrate`. Чужой выбор по умолчанию
  // сохраняем как есть и назначаем рубль только тогда, когда выбора нет.
  if (!supportedCurrencies.some((currency) => currency.is_default)) {
    rubCurrency.is_default = true;
  }

  return supportedCurrencies;
}

export function currenciesForExistingStore(
  storeName: string | null | undefined,
  existingCurrencies: {
    currency_code: string;
    is_default?: boolean | null;
  }[],
) {
  const isUntouchedMedusaScaffold =
    (storeName === "Medusa Store" || storeName === "Default Store") &&
    existingCurrencies.length === 1 &&
    existingCurrencies[0].currency_code === "eur";

  if (isUntouchedMedusaScaffold) {
    return [
      { currency_code: "rub", is_default: true, is_tax_inclusive: true },
    ];
  }

  return mergeSupportedCurrencies(existingCurrencies);
}

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
    fields: [
      "id",
      "name",
      "default_sales_channel_id",
      "supported_currencies.currency_code",
      "supported_currencies.is_default",
    ],
  });
  const existingStore = existingStores[0];
  // ADR-001 §2: all catalog prices are entered and stored WITH VAT (gross,
  // tax-inclusive). In Medusa 2.17 tax-inclusivity is a pricing-module "price
  // preference" (attribute + value + is_tax_inclusive), never a per-price flag.
  // Passing is_tax_inclusive on a supported currency makes create/updateStores
  // upsert a `currency_code`=`rub` price preference via
  // updatePricePreferencesAsArrayStep. That upsert resolves the flag as
  // `is_tax_inclusive ?? prevEntry.is_tax_inclusive`, so it is idempotent and
  // never downgrades an already tax-inclusive currency on re-runs.
  if (existingStore) {
    // Живому магазину список валют не задаём, а дополняем — см.
    // mergeSupportedCurrencies выше и учение 2026-07-27 (§3.1).
    const existingCurrencies = (existingStore.supported_currencies || []).filter(
      (currency): currency is NonNullable<typeof currency> => currency !== null,
    );
    // A fresh Medusa database contains a placeholder EUR store. It is scaffold,
    // not merchant data, so the RU-first bootstrap replaces it with RUB. Any
    // renamed or multi-currency store is treated as live data and only augmented.
    const supportedCurrencies = currenciesForExistingStore(
      existingStore.name,
      existingCurrencies,
    );

    // Имя магазина здесь больше не выставляется: на живой базе оно уже
    // переименовано в «Mario Mikke» скриптом import-mario-mikke.ts, и повторный
    // прогон сида (то же учение 2026-07-27) откатывал бы его в «Default Store».
    // Канал продаж по умолчанию тоже не перебиваем: проставляем, только если у
    // магазина его нет.
    const storeUpdate: {
      supported_currencies: typeof supportedCurrencies;
      default_sales_channel_id?: string;
    } = {
      supported_currencies: supportedCurrencies,
    };

    if (!existingStore.default_sales_channel_id) {
      storeUpdate.default_sales_channel_id = defaultSalesChannel.id;
    }

    await updateStoresWorkflow(container).run({
      input: {
        selector: { id: existingStore.id },
        update: storeUpdate,
      },
    });
  } else {
    await createStoresWorkflow(container).run({
      input: {
        stores: [
          {
            name: "Default Store",
            supported_currencies: [
              {
                currency_code: "rub",
                is_default: true,
                is_tax_inclusive: true,
              },
            ],
            default_sales_channel_id: defaultSalesChannel.id,
          },
        ],
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
            // Region tax lines are computed by Medusa automatically. This is the
            // Region module default (automatic_taxes = boolean().default(true)),
            // set explicitly so the RU-first tax contract is self-evident and
            // stays correct even if the upstream default ever changes.
            automatic_taxes: true,
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

  // Provision the single default VAT rate for the RU tax region. Catalog prices
  // are gross / tax-inclusive (see the store block above), so Medusa derives
  // the tax portion as gross * rate / (100 + rate) = gross * 5 / 105 rather
  // than adding it on top. The rate is created only when the RU tax region has
  // no `vat5` rate yet, keeping the seed idempotent; the TaxRate model also
  // enforces a single default rate per region (index IDX_single_default_region).
  // Note: is_combinable is intentionally left at its model default (false) — it
  // is not part of CreateTaxRateDTO in 2.17 and a lone flat rate must not stack.
  logger.info("Seeding default VAT tax rate...");
  const { data: taxRegionsWithRates } = await query.graph({
    entity: "tax_region",
    fields: [
      "id",
      "country_code",
      "tax_rates.id",
      "tax_rates.code",
      "tax_rates.is_default",
    ],
  });
  const ruTaxRegion = taxRegionsWithRates.find(
    (taxRegion) => taxRegion.country_code === "ru",
  );

  if (ruTaxRegion) {
    const ruTaxRates = ruTaxRegion.tax_rates || [];
    const hasVat5Rate = ruTaxRates.some((taxRate) => taxRate?.code === "vat5");
    // Учение 2026-07-27 (§3.1): `tax_rate` вырос с 0 до 1 — это не дубль.
    // Ищем и создаём по одному и тому же полю `code`, поэтому второй ставки
    // "vat5" в регионе не появится; в восстановленной базе ставок не было
    // вовсе, и ставка появилась законно. Опасен другой случай: чужая база со
    // своей ставкой по умолчанию. is_default защищён уникальным частичным
    // индексом IDX_single_default_region, так что вторая ставка по умолчанию
    // уронила бы весь `db:migrate`, а тихая замена чужого НДС на 5% была бы
    // хуже отказа. Поэтому чужую налоговую настройку не трогаем и говорим об
    // этом в лог.
    const existingDefaultRate = ruTaxRates.find(
      (taxRate) => taxRate?.is_default,
    );

    if (!hasVat5Rate && existingDefaultRate) {
      logger.warn(
        `Tax region "ru" already has a default tax rate ` +
          `("${existingDefaultRate.code}", ${existingDefaultRate.rate}%). ` +
          `Skipping the "НДС 5%" (vat5) rate: this database was provisioned ` +
          `elsewhere. Review the tax setup manually.`,
      );
    } else if (!hasVat5Rate) {
      await createTaxRatesWorkflow(container).run({
        input: [
          {
            tax_region_id: ruTaxRegion.id,
            name: "НДС 5%",
            code: "vat5",
            rate: 5,
            is_default: true,
          },
        ],
      });
    }
  }
  logger.info("Finished seeding default VAT tax rate.");

  logger.info("Seeding stock location data...");
  const { data: existingStockLocations } = await query.graph({
    entity: "stock_location",
    fields: ["id", "name", "sales_channels.id", "fulfillment_providers.id"],
  });
  // Учение 2026-07-27 (§3.1): на восстановленной чужой базе поиск только по
  // имени не узнал существующий склад ("European Warehouse"), и сид завёл
  // второй — со своим адресом, каналом продаж и fulfillment-провайдером
  // (stock_location 1 -> 2). Остатки после такого расходятся по двум локациям.
  // Имя остаётся первым признаком (тот же приём, что и с fulfillment set), но
  // если склад в базе уже есть под любым именем, переиспользуем его: задача
  // сида — обеспечить ПЕРВЫЙ склад, а не именно свой. Запасной вариант
  // совпадает с import-mario-mikke.ts, который тоже берёт первый склад из базы.
  const existingStockLocation =
    existingStockLocations.find(
      (location) => location.name === "Основной склад",
    ) || existingStockLocations[0];
  let stockLocation: { id: string } | undefined = existingStockLocation;
  // Привязки читаем у найденного склада, а не выводим из флага «склад только
  // что создан»: раньше существующий, но не привязанный склад навсегда
  // оставался без fulfillment-провайдера и канала продаж, а на чужой базе
  // привязки создавались заново вместе с дублем склада.
  const linkedFulfillmentProviderIds = (
    existingStockLocation?.fulfillment_providers || []
  ).map((fulfillmentProvider) => fulfillmentProvider?.id);
  const linkedSalesChannelIds = (
    existingStockLocation?.sales_channels || []
  ).map((salesChannel) => salesChannel?.id);

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
  }

  if (!linkedFulfillmentProviderIds.includes("manual_manual")) {
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

  // Привязка канала продаж — по факту её отсутствия у конкретного склада:
  // повторная привязка того же канала переписала бы строку связи (upsert по
  // составному ключу) и воскресила бы связь, которую магазин мог снять руками.
  if (!linkedSalesChannelIds.includes(defaultSalesChannel.id)) {
    await linkSalesChannelsToStockLocationWorkflow(container).run({
      input: {
        id: stockLocation.id,
        add: [defaultSalesChannel.id],
      },
    });
  }
  logger.info("Finished seeding stock location data.");
}
