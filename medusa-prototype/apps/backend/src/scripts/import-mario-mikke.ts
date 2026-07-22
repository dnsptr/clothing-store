import { MedusaContainer } from "@medusajs/framework";
import {
  ContainerRegistrationKeys,
  ModuleRegistrationName,
  Modules,
  ProductStatus,
} from "@medusajs/framework/utils";
import {
  batchProductVariantsWorkflow,
  createCollectionsWorkflow,
  createInventoryLevelsWorkflow,
  createProductCategoriesWorkflow,
  createProductsWorkflow,
  createRegionsWorkflow,
  createShippingOptionsWorkflow,
  createTaxRegionsWorkflow,
  deleteProductsWorkflow,
  updateProductOptionsWorkflow,
  updateProductsWorkflow,
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

  if (
    process.env.NODE_ENV === "production" &&
    storefrontUrl.includes("localhost")
  ) {
    throw new Error(
      `STOREFRONT_URL must point to the public storefront URL before running ` +
        `catalog import in production. Offending value: "${storefrontUrl}". ` +
        `Set STOREFRONT_URL to your production storefront address (e.g. ` +
        `https://your-store.example.com) and re-run the import.`,
    );
  }

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

  // ---------------------------------------------------------------------------
  // DEPRECATED (remove after BOOT-002): starter demo product cleanup.
  //
  // The Medusa starter used to seed demo products (t-shirt, sweatshirt, ...).
  // Since BOOT-002 the RU-first bootstrap no longer creates them, so on a fresh
  // database this block is a no-op and will become dead code. It is kept only to
  // clean up databases that were provisioned before BOOT-002.
  //
  // NOTE (IMPORT-001): the previous implementation ALSO deleted every product
  // whose metadata.import_source === IMPORT_SOURCE and recreated it from
  // scratch. That delete/recreate is exactly what IMPORT-001 removes — catalog
  // products are now upserted below by handle/SKU, preserving their Medusa IDs,
  // inventory levels and order links (ADR-001 §4). Only the starter demo handles
  // are considered here, and only when they carry no orders, so this cleanup can
  // never destroy real catalog or order data.
  // ---------------------------------------------------------------------------
  const { data: starterProducts } = await query.graph({
    entity: "product",
    fields: ["id", "handle"],
    filters: { handle: Array.from(STARTER_HANDLES) },
  });

  if (starterProducts.length) {
    // Best-effort safety check: never delete a starter product that has order
    // history. order_line_item keeps a product_id snapshot for each ordered line.
    let protectedProductIds: Set<string>;
    try {
      const { data: orderedLines } = await query.graph({
        entity: "order_line_item",
        fields: ["product_id"],
        filters: { product_id: starterProducts.map((product) => product.id) },
      });
      protectedProductIds = new Set(
        orderedLines
          .map((line) => line.product_id)
          .filter((id): id is string => Boolean(id)),
      );
    } catch (error) {
      // If order history cannot be verified, err on the side of caution and keep
      // every starter product rather than risk deleting one tied to real orders.
      protectedProductIds = new Set(
        starterProducts.map((product) => product.id),
      );
      logger.warn(
        `[IMPORT-001] Could not verify order history for starter demo ` +
          `products; leaving them untouched. ` +
          `${(error as Error)?.message ?? ""}`,
      );
    }

    const starterToDelete = starterProducts.filter(
      (product) => !protectedProductIds.has(product.id),
    );
    const starterKept = starterProducts.filter((product) =>
      protectedProductIds.has(product.id),
    );

    if (starterKept.length) {
      logger.warn(
        `[IMPORT-001] Keeping ${starterKept.length} starter demo product(s) ` +
          `with order history or unverifiable status: ` +
          `${starterKept.map((product) => product.handle).join(", ")}.`,
      );
    }

    if (starterToDelete.length) {
      logger.warn(
        `[IMPORT-001][deprecated] Deleting ${starterToDelete.length} starter ` +
          `demo product(s) with no orders: ` +
          `${starterToDelete.map((product) => product.handle).join(", ")}. ` +
          `This starter cleanup is deprecated (see BOOT-002) and will be removed.`,
      );
      await deleteProductsWorkflow(container).run({
        input: { ids: starterToDelete.map((product) => product.id) },
      });
    }
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

  // ---------------------------------------------------------------------------
  // Catalog upsert (IMPORT-001, ADR-001 §4)
  //
  // Reconciliation keys are IMMUTABLE:
  //   - product  ->  handle  (`mario-mikke-${id}`)
  //   - variant  ->  sku     (`MM-<id>-<SIZE>-<colorIndex>`)
  //
  // We upsert by these keys and preserve the internal Medusa product/variant IDs
  // so that order links and inventory levels survive a re-import. Delete/recreate
  // is forbidden here: it churns IDs, wipes inventory levels, orphans orders and
  // would break the future 1С sync, which keys off these IDs.
  // ---------------------------------------------------------------------------

  // Desired catalog state. `productLevel` intentionally omits the handle (it is
  // the match key, never mutated) and omits variants/options so it can be fed to
  // updateProductsWorkflow WITHOUT triggering a variant/option reconcile — see
  // the update path below for why that matters.
  const desiredProducts = MARIO_MIKKE_PRODUCTS.map((product) => {
    const handle = `mario-mikke-${product.id}`;
    const sizes = product.availableSizes.length
      ? product.availableSizes
      : ["One Size"];
    const colorNames = product.colors.map((color) => color.name);
    const options = [
      { title: "Размер", values: sizes },
      { title: "Цвет", values: colorNames },
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

    const productLevel = {
      title: product.name,
      status: ProductStatus.PUBLISHED,
      thumbnail: `${storefrontUrl}${product.images[0]}`,
      images: product.images.map((image) => ({
        url: `${storefrontUrl}${image}`,
      })),
      category_ids: [categoryIds.get(product.categorySlug)!],
      collection_id: productCollectionIds.get(product.id),
      shipping_profile_id: shippingProfile.id,
      sales_channels: [{ id: salesChannel.id }],
      metadata: {
        import_source: IMPORT_SOURCE,
        frontend_id: product.id,
        material_slugs: product.materialSlugs,
        colors: product.colors,
        is_new: Boolean(product.isNew),
        is_sold_out: Boolean(product.isSoldOut),
      },
    };

    return { handle, productLevel, options, variants };
  });

  // Find which catalog products already exist, keyed by handle. We also pull the
  // existing option value sets and variant SKUs so we can reconcile in place.
  const { data: existingCatalogProducts } = await query.graph({
    entity: "product",
    fields: [
      "id",
      "handle",
      "options.id",
      "options.title",
      "options.values.id",
      "options.values.value",
      "variants.id",
      "variants.sku",
    ],
    filters: { handle: desiredProducts.map((product) => product.handle) },
  });
  const existingByHandle = new Map(
    existingCatalogProducts.map((product) => [product.handle, product]),
  );

  const productsToCreate = desiredProducts.filter(
    (product) => !existingByHandle.has(product.handle),
  );
  const productsToUpdate = desiredProducts.filter((product) =>
    existingByHandle.has(product.handle),
  );

  // Variant IDs newly created in this run (variants of brand-new products are
  // collected separately, via createdProductIds). Only these receive a starting
  // inventory level; every pre-existing variant keeps the stock it already has.
  const createdProductIds: string[] = [];
  const newVariantIds = new Set<string>();

  // --- New products: create with full options + variants ----------------------
  // On an empty database every product is new, so this path is identical to the
  // previous behaviour (first run == before).
  if (productsToCreate.length) {
    const { result: created } = await createProductsWorkflow(container).run({
      input: {
        products: productsToCreate.map((product) => ({
          handle: product.handle,
          ...product.productLevel,
          options: product.options,
          variants: product.variants,
        })),
      },
    });
    for (const product of created) {
      createdProductIds.push(product.id);
    }
  }

  // --- Existing products: upsert in place, preserving IDs ---------------------
  for (const product of productsToUpdate) {
    const existing = existingByHandle.get(product.handle)!;

    // (1) Product-level fields only. We deliberately DO NOT pass `variants` or
    // `options` here: updateProductsWorkflow -> productModuleService.upsertProducts
    // REPLACES any relation present in the payload, which would delete variants
    // missing from the list. Omitting them leaves variants, their IDs and their
    // inventory untouched. Catalog-owned fields (title, status, images,
    // thumbnail, category, collection, sales channel, metadata) are overwritten;
    // fields the catalog does not manage (e.g. a description edited in the admin)
    // are preserved because they are never sent.
    await updateProductsWorkflow(container).run({
      input: { products: [{ id: existing.id, ...product.productLevel }] },
    });

    // (2) Additively sync option VALUES. A new size/colour in the catalog must be
    // added to the product's options before its variants can be created — the
    // product module rejects a variant that references an unknown option value.
    // We send the UNION of existing + catalog values, so nothing is ever removed
    // (dropping a size/colour is a manual admin action, mirroring the variant
    // policy below). This runs only when new values are detected, so a
    // same-catalog re-import writes nothing here.
    const existingOptions = existing.options || [];
    let optionsAligned = true;
    const optionValueUpdates = product.options
      .map((option) => {
        const match = existingOptions.find(
          (existingOption) => existingOption.title === option.title,
        );
        if (!match) {
          // The option itself is missing — a structural change we will not make
          // automatically. Suppress new-variant creation for this product.
          optionsAligned = false;
          logger.warn(
            `[IMPORT-001] Product "${product.handle}" is missing option ` +
              `"${option.title}"; skipping automatic variant creation for it. ` +
              `Add the option in the admin if this is intentional.`,
          );
          return null;
        }
        const existingValues: string[] = (match.values || []).map(
          (value) => value.value,
        );
        const existingValueSet = new Set(existingValues);
        const hasNewValues = option.values.some(
          (value) => !existingValueSet.has(value),
        );
        if (!hasNewValues) {
          return null;
        }
        return {
          id: match.id,
          title: option.title,
          values: Array.from(new Set([...existingValues, ...option.values])),
        };
      })
      .filter((update): update is NonNullable<typeof update> => update !== null);

    for (const optionUpdate of optionValueUpdates) {
      await updateProductOptionsWorkflow(container).run({
        input: {
          selector: { id: optionUpdate.id },
          update: { values: optionUpdate.values },
        },
      });
    }

    // (3) Reconcile variants by SKU. Existing SKUs are updated in place — keeping
    // their variant ID — and catalog SKUs not yet present are created. We NEVER
    // populate `delete`: a variant that disappears from the catalog is left
    // intact so its order lines and stock survive. Pruning variants is a
    // deliberate manual admin operation. A SKU already encodes size+colour, so
    // the option combination of an existing variant never changes; only the
    // mutable, catalog-owned fields (price and the derived title) are synced.
    // Prices upsert into the variant's existing price set, so re-runs do not
    // create duplicate prices.
    const existingVariantIdBySku = new Map<string, string>(
      (existing.variants || []).map(
        (variant) => [variant.sku, variant.id] as [string, string],
      ),
    );
    const variantsToUpdate = product.variants
      .filter((variant) => existingVariantIdBySku.has(variant.sku))
      .map((variant) => ({
        id: existingVariantIdBySku.get(variant.sku)!,
        title: variant.title,
        prices: variant.prices,
      }));
    const variantsToCreate = optionsAligned
      ? product.variants
          .filter((variant) => !existingVariantIdBySku.has(variant.sku))
          .map((variant) => ({
            product_id: existing.id,
            title: variant.title,
            sku: variant.sku,
            options: variant.options,
            prices: variant.prices,
            manage_inventory: true,
            allow_backorder: false,
          }))
      : [];

    if (variantsToUpdate.length || variantsToCreate.length) {
      const { result: batchResult } = await batchProductVariantsWorkflow(
        container,
      ).run({
        // No `delete` key on purpose — see the comment above.
        input: { create: variantsToCreate, update: variantsToUpdate },
      });
      for (const created of batchResult.created || []) {
        newVariantIds.add(created.id);
      }
    }
  }

  // --- Starting inventory for NEW variants only -------------------------------
  // Brand-new products contribute all of their variants; existing products
  // contribute only the variants created above. Existing variants are never
  // included, so their stocked quantities survive a re-import.
  const inventoryProductIds = Array.from(
    new Set([
      ...createdProductIds,
      ...productsToUpdate.map(
        (product) => existingByHandle.get(product.handle)!.id,
      ),
    ]),
  );
  const createdProductIdSet = new Set(createdProductIds);
  let inventoryItemIds: string[] = [];

  if (inventoryProductIds.length) {
    const { data: productsForInventory } = await query.graph({
      entity: "product",
      fields: [
        "id",
        "variants.id",
        "variants.inventory_items.inventory_item_id",
      ],
      filters: { id: inventoryProductIds },
    });
    inventoryItemIds = productsForInventory.flatMap((product) =>
      (product.variants || [])
        .filter(
          (variant) =>
            createdProductIdSet.has(product.id) ||
            newVariantIds.has(variant.id),
        )
        .flatMap((variant) =>
          (variant.inventory_items || [])
            .filter((item): item is NonNullable<typeof item> => item !== null)
            .map((item) => item.inventory_item_id),
        ),
    );
  }

  // Guard against re-creating a level that already exists so the import stays
  // idempotent even after a partially-failed run. Brand-new inventory items have
  // no level yet, so on the normal path everything simply passes through.
  let seededInventoryCount = 0;
  if (inventoryItemIds.length) {
    let itemsNeedingLevel = inventoryItemIds;
    try {
      const { data: existingLevels } = await query.graph({
        entity: "inventory_level",
        fields: ["inventory_item_id"],
        filters: {
          inventory_item_id: inventoryItemIds,
          location_id: stockLocation.id,
        },
      });
      const alreadyLeveled = new Set(
        existingLevels.map((level) => level.inventory_item_id),
      );
      itemsNeedingLevel = inventoryItemIds.filter(
        (inventoryItemId) => !alreadyLeveled.has(inventoryItemId),
      );
    } catch (error) {
      logger.warn(
        `[IMPORT-001] Could not pre-check inventory levels; creating levels ` +
          `for the ${inventoryItemIds.length} collected new inventory item(s). ` +
          `${(error as Error)?.message ?? ""}`,
      );
    }

    if (itemsNeedingLevel.length) {
      await createInventoryLevelsWorkflow(container).run({
        input: {
          inventory_levels: itemsNeedingLevel.map((inventoryItemId) => ({
            location_id: stockLocation.id,
            inventory_item_id: inventoryItemId,
            stocked_quantity: 25,
          })),
        },
      });
      seededInventoryCount = itemsNeedingLevel.length;
    }
  }

  logger.info(
    `[IMPORT-001] Catalog upsert complete: ${productsToCreate.length} product(s) ` +
      `created, ${productsToUpdate.length} updated in place, ` +
      `${newVariantIds.size} new variant(s) added, ` +
      `${seededInventoryCount} inventory level(s) seeded.`,
  );
}
