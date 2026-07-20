import { MedusaContainer } from "@medusajs/framework";
import {
  ContainerRegistrationKeys,
  ModuleRegistrationName,
  Modules,
  ProductStatus,
} from "@medusajs/framework/utils";
import {
  createCollectionsWorkflow,
  createInventoryLevelsWorkflow,
  createProductCategoriesWorkflow,
  createProductsWorkflow,
  createRegionsWorkflow,
  createShippingOptionsWorkflow,
  createTaxRegionsWorkflow,
  deleteProductsWorkflow,
  updateStoresWorkflow,
} from "@medusajs/medusa/core-flows";
import {
  MARIO_MIKKE_COLLECTIONS,
  MARIO_MIKKE_PRODUCTS,
} from "./data/mario-mikke-catalog";

const IMPORT_SOURCE = "mario-mikke-demo";
const STARTER_HANDLES = new Set([
  "t-shirt",
  "sweatshirt",
  "sweatpants",
  "shorts",
]);

type ExecArgs = {
  container: MedusaContainer;
  args: string[];
};

export default async function importMarioMikkeCatalog({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const link = container.resolve(ContainerRegistrationKeys.LINK);
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const fulfillmentModuleService = container.resolve(ModuleRegistrationName.FULFILLMENT);
  const storefrontUrl = (
    process.env.STOREFRONT_URL || "http://localhost:3000"
  ).replace(/\/$/, "");

  logger.info("Preparing Mario Mikke demo catalog...");

  const { data: stores } = await query.graph({
    entity: "store",
    fields: [
      "id",
      "supported_currencies.currency_code",
      "supported_currencies.is_default",
    ],
  });
  const store = stores[0];

  if (!store) {
    throw new Error(
      "No Medusa store exists. Run the initial migration seed first.",
    );
  }

  const currentCurrencies = store.supported_currencies || [];
  const supportedCurrencies = [
    { currency_code: "rub", is_default: true },
    ...currentCurrencies
      .filter(
        (currency): currency is NonNullable<typeof currency> =>
          currency !== null && currency.currency_code !== "rub",
      )
      .map((currency) => ({
        currency_code: currency.currency_code,
        is_default: false,
      })),
  ];

  await updateStoresWorkflow(container).run({
    input: {
      selector: { id: store.id },
      update: {
        name: "Mario Mikke",
        supported_currencies: supportedCurrencies,
      },
    },
  });

  const { data: regions } = await query.graph({
    entity: "region",
    fields: ["id", "name", "currency_code", "countries.iso_2"],
  });

  if (!regions.some((region) => region.currency_code === "rub")) {
    await createRegionsWorkflow(container).run({
      input: {
        regions: [
          {
            name: "Россия",
            currency_code: "rub",
            countries: ["ru"],
            payment_providers: ["pp_system_default"],
          },
        ],
      },
    });
  }

  const { data: taxRegions } = await query.graph({
    entity: "tax_region",
    fields: ["id", "country_code"],
  });

  if (!taxRegions.some((region) => region.country_code === "ru")) {
    await createTaxRegionsWorkflow(container).run({
      input: [{ country_code: "ru", provider_id: "tp_system" }],
    });
  }

  const { data: salesChannels } = await query.graph({
    entity: "sales_channel",
    fields: ["id", "name"],
  });
  const salesChannel = salesChannels[0];

  const { data: shippingProfiles } = await query.graph({
    entity: "shipping_profile",
    fields: ["id", "name"],
  });
  const shippingProfile = shippingProfiles[0];

  const { data: stockLocations } = await query.graph({
    entity: "stock_location",
    fields: ["id", "name"],
  });
  const stockLocation = stockLocations[0];

  if (!salesChannel || !shippingProfile || !stockLocation) {
    throw new Error(
      "Sales channel, shipping profile, or stock location is missing.",
    );
  }

  const { data: fulfillmentSets } = await query.graph({
    entity: "fulfillment_set",
    fields: ["id", "name", "service_zones.id"],
  });
  const existingRuFulfillmentSet = fulfillmentSets.find(
    (fulfillmentSet) => fulfillmentSet.name === "MVP Россия delivery",
  );
  let ruServiceZoneId = existingRuFulfillmentSet?.service_zones[0]?.id;

  if (!ruServiceZoneId) {
    const createdRuFulfillmentSet = await fulfillmentModuleService.createFulfillmentSets({
      name: "MVP Россия delivery",
      type: "shipping",
      service_zones: [
        {
          name: "Россия",
          geo_zones: [{ country_code: "ru", type: "country" }],
        },
      ],
    });
    ruServiceZoneId = createdRuFulfillmentSet.service_zones[0]?.id;
    await link.create({
      [Modules.STOCK_LOCATION]: { stock_location_id: stockLocation.id },
      [Modules.FULFILLMENT]: { fulfillment_set_id: createdRuFulfillmentSet.id },
    });
  }

  if (!ruServiceZoneId) {
    throw new Error("RU fulfillment set has no service zone.");
  }

  const { data: shippingOptions } = await query.graph({
    entity: "shipping_option",
    fields: ["id", "name", "service_zone_id"],
  });

  const ruShippingOption = shippingOptions.find(
    (option) => option.name === "MVP доставка по России",
  );

  if (!ruShippingOption) {
    await createShippingOptionsWorkflow(container).run({
      input: [
        {
          name: "MVP доставка по России",
          price_type: "flat",
          provider_id: "manual_manual",
          service_zone_id: ruServiceZoneId,
          shipping_profile_id: shippingProfile.id,
          type: {
            label: "MVP доставка",
            description: "Тестовая доставка для локального MVP.",
            code: "mvp-ru",
          },
          prices: [{ currency_code: "rub", amount: 0 }],
          rules: [
            { attribute: "enabled_in_store", value: "true", operator: "eq" },
            { attribute: "is_return", value: "false", operator: "eq" },
          ],
        },
      ],
    });
  } else if (ruShippingOption.service_zone_id !== ruServiceZoneId) {
    await fulfillmentModuleService.updateShippingOptions(ruShippingOption.id, {
      service_zone_id: ruServiceZoneId,
    });
  }

  const { data: existingProducts } = await query.graph({
    entity: "product",
    fields: ["id", "handle", "metadata"],
  });
  const productsToDelete = existingProducts.filter(
    (product) =>
      product.metadata?.import_source === IMPORT_SOURCE ||
      STARTER_HANDLES.has(product.handle),
  );

  if (productsToDelete.length) {
    await deleteProductsWorkflow(container).run({
      input: { ids: productsToDelete.map((product) => product.id) },
    });
  }

  const categoryDefinitions = Array.from(
    new Map(
      MARIO_MIKKE_PRODUCTS.map((product) => [
        product.categorySlug,
        { name: product.category, handle: product.categorySlug },
      ]),
    ).values(),
  );
  const { data: existingCategories } = await query.graph({
    entity: "product_category",
    fields: ["id", "name", "handle"],
  });
  const missingCategories = categoryDefinitions.filter(
    (category) =>
      !existingCategories.some(
        (existing) => existing.handle === category.handle,
      ),
  );

  if (missingCategories.length) {
    await createProductCategoriesWorkflow(container).run({
      input: {
        product_categories: missingCategories.map((category) => ({
          ...category,
          is_active: true,
        })),
      },
    });
  }

  const { data: categories } = await query.graph({
    entity: "product_category",
    fields: ["id", "name", "handle"],
  });
  const categoryIds = new Map(
    categories.map((category) => [category.handle, category.id]),
  );

  const { data: existingCollections } = await query.graph({
    entity: "product_collection",
    fields: ["id", "title", "handle"],
  });
  const missingCollections = MARIO_MIKKE_COLLECTIONS.filter(
    (collection) =>
      !existingCollections.some(
        (existing) => existing.handle === collection.handle,
      ),
  );

  if (missingCollections.length) {
    await createCollectionsWorkflow(container).run({
      input: {
        collections: missingCollections.map(({ title, handle }) => ({
          title,
          handle,
        })),
      },
    });
  }

  const { data: collections } = await query.graph({
    entity: "product_collection",
    fields: ["id", "title", "handle"],
  });
  const collectionIds = new Map(
    collections.map((collection) => [collection.handle, collection.id]),
  );
  const productCollectionIds = new Map<string, string>();

  for (const collection of MARIO_MIKKE_COLLECTIONS) {
    const collectionId = collectionIds.get(collection.handle);
    if (!collectionId) continue;

    for (const productId of collection.productIds) {
      productCollectionIds.set(productId, collectionId);
    }
  }

  const products = MARIO_MIKKE_PRODUCTS.map((product) => {
    const sizes = product.availableSizes.length
      ? product.availableSizes
      : ["One Size"];
    const options = [
      { title: "Размер", values: sizes },
      { title: "Цвет", values: product.colors.map((color) => color.name) },
    ];
    const variants = sizes.flatMap((size) =>
      product.colors.map((color, colorIndex) => ({
        title: `${size} / ${color.name}`,
        sku: `MM-${product.id.padStart(3, "0")}-${size.replace(/\s+/g, "-").toUpperCase()}-${colorIndex + 1}`,
        options: {
          Размер: size,
          Цвет: color.name,
        },
        prices: [{ amount: product.price, currency_code: "rub" }],
        manage_inventory: true,
        allow_backorder: false,
      })),
    );

    return {
      title: product.name,
      handle: `mario-mikke-${product.id}`,
      status: ProductStatus.PUBLISHED,
      thumbnail: `${storefrontUrl}${product.images[0]}`,
      images: product.images.map((image) => ({
        url: `${storefrontUrl}${image}`,
      })),
      category_ids: [categoryIds.get(product.categorySlug)!],
      collection_id: productCollectionIds.get(product.id),
      shipping_profile_id: shippingProfile.id,
      sales_channels: [{ id: salesChannel.id }],
      options,
      variants,
      metadata: {
        import_source: IMPORT_SOURCE,
        frontend_id: product.id,
        material_slugs: product.materialSlugs,
        colors: product.colors,
        is_new: Boolean(product.isNew),
        is_sold_out: Boolean(product.isSoldOut),
      },
    };
  });

  const { result: createdProducts } = await createProductsWorkflow(
    container,
  ).run({
    input: { products },
  });

  const { data: importedProducts } = await query.graph({
    entity: "product",
    fields: ["id", "variants.inventory_items.inventory_item_id"],
    filters: { id: createdProducts.map((product) => product.id) },
  });
  const inventoryItemIds = importedProducts.flatMap((product) =>
    (product.variants || []).flatMap((variant) =>
      (variant.inventory_items || [])
        .filter((item): item is NonNullable<typeof item> => item !== null)
        .map((item) => item.inventory_item_id),
    ),
  );

  if (inventoryItemIds.length) {
    await createInventoryLevelsWorkflow(container).run({
      input: {
        inventory_levels: inventoryItemIds.map((inventoryItemId) => ({
          location_id: stockLocation.id,
          inventory_item_id: inventoryItemId,
          stocked_quantity: 25,
        })),
      },
    });
  }

  logger.info(
    `Imported ${createdProducts.length} Mario Mikke products with ${inventoryItemIds.length} inventory items.`,
  );
}
