import { medusaIntegrationTestRunner } from "@medusajs/test-utils";
import { MedusaContainer } from "@medusajs/framework";
import {
  ContainerRegistrationKeys,
  ModuleRegistrationName,
  Modules,
} from "@medusajs/framework/utils";
import { createShippingProfilesWorkflow } from "@medusajs/medusa/core-flows";

import seedInitialData from "../../src/migration-scripts/initial-data-seed";
import importMarioMikkeCatalog from "../../src/scripts/import-mario-mikke";

// Booting the full Medusa app (create DB -> migrate -> start) and running the
// seed/import twice comfortably exceeds Jest's 5s default, so raise the per-file
// timeout the same way Medusa's own integration specs do.
jest.setTimeout(120000);

// Minimal structural views over the Medusa module services used below. They mirror
// the parts of IInventoryService / IFulfillmentModuleService (@medusajs/framework/types,
// 2.17.2) that these tests rely on and keep the intent self-documenting.
type InventoryLevelRecord = {
  id: string;
  inventory_item_id: string;
  location_id: string;
  stocked_quantity: number;
};
type InventoryModuleLike = {
  listInventoryLevels: (selector: {
    inventory_item_id?: string[];
    location_id?: string[];
  }) => Promise<InventoryLevelRecord[]>;
  updateInventoryLevels: (
    updates: Array<{
      inventory_item_id: string;
      location_id: string;
      stocked_quantity: number;
    }>
  ) => Promise<InventoryLevelRecord[]>;
};
type FulfillmentModuleLike = {
  listShippingProfiles: (selector: {
    type?: string;
  }) => Promise<Array<{ id: string }>>;
};

type CatalogSnapshot = {
  handles: string[];
  productIdByHandle: Record<string, string>;
  variantIdBySku: Record<string, string>;
  inventoryItemIdBySku: Record<string, string>;
};

// The RU-first seed intentionally omits a shipping profile (Russian shipping
// options are deferred to the CDEK/Yandex integration stage), but
// import-mario-mikke.ts requires one to exist. In a real deployment it comes from
// the original Medusa starter seed; on a clean test database we provision the
// default profile here, mirroring the canonical Medusa seed script.
const ensureDefaultShippingProfile = async (
  container: MedusaContainer
): Promise<void> => {
  const fulfillmentModuleService = container.resolve(
    ModuleRegistrationName.FULFILLMENT
  ) as unknown as FulfillmentModuleLike;

  const existingProfiles = await fulfillmentModuleService.listShippingProfiles({
    type: "default",
  });
  if (existingProfiles.length > 0) {
    return;
  }

  await createShippingProfilesWorkflow(container).run({
    input: {
      data: [{ name: "Default Shipping Profile", type: "default" }],
    },
  });
};

// Snapshot the imported Mario Mikke catalog as stable, comparable identity maps
// keyed by the natural upsert keys (product handle, variant SKU).
const snapshotCatalog = async (
  container: MedusaContainer
): Promise<CatalogSnapshot> => {
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const { data: products } = await query.graph({
    entity: "product",
    fields: [
      "id",
      "handle",
      "variants.id",
      "variants.sku",
      "variants.inventory_items.inventory_item_id",
    ],
  });

  const productIdByHandle: Record<string, string> = {};
  const variantIdBySku: Record<string, string> = {};
  const inventoryItemIdBySku: Record<string, string> = {};

  for (const product of products) {
    if (
      typeof product.handle !== "string" ||
      !product.handle.startsWith("mario-mikke-")
    ) {
      continue;
    }
    productIdByHandle[product.handle] = product.id;

    for (const variant of (product.variants ?? []).filter(Boolean)) {
      if (!variant.sku) {
        continue;
      }
      variantIdBySku[variant.sku] = variant.id;

      const inventoryItems = (variant.inventory_items ?? []).filter(Boolean);
      if (inventoryItems.length > 0) {
        inventoryItemIdBySku[variant.sku] = inventoryItems[0].inventory_item_id;
      }
    }
  }

  return {
    handles: Object.keys(productIdByHandle),
    productIdByHandle,
    variantIdBySku,
    inventoryItemIdBySku,
  };
};

medusaIntegrationTestRunner({
  testSuite: ({ api, getContainer }) => {
    describe("initial_data_seed idempotency (RU-first bootstrap)", () => {
      const TRACKED_ENTITIES = [
        "store",
        "region",
        "tax_region",
        "sales_channel",
        "api_key",
        "stock_location",
        "fulfillment_set",
      ];

      it("provisions the RU commerce skeleton exactly once when run twice", async () => {
        const container = getContainer();
        const query = container.resolve(ContainerRegistrationKeys.QUERY);

        const snapshotCounts = async (): Promise<Record<string, number>> => {
          const counts: Record<string, number> = {};
          for (const entity of TRACKED_ENTITIES) {
            const { data } = await query.graph({ entity, fields: ["id"] });
            counts[entity] = data.length;
          }
          return counts;
        };

        await seedInitialData({ container });
        const afterFirstRun = await snapshotCounts();

        await seedInitialData({ container });
        const afterSecondRun = await snapshotCounts();

        // Idempotency: a second seed run must not create any additional entities.
        expect(afterSecondRun).toEqual(afterFirstRun);

        // The RU skeleton is provisioned exactly once.
        expect(afterFirstRun.store).toBe(1);
        expect(afterFirstRun.region).toBe(1);
        expect(afterFirstRun.tax_region).toBe(1);
        expect(afterFirstRun.sales_channel).toBe(1);
        expect(afterFirstRun.stock_location).toBe(1);
        expect(afterFirstRun.fulfillment_set).toBe(1);
        expect(afterFirstRun.api_key).toBeGreaterThanOrEqual(1);

        // Store is RUB-only, with RUB as the default currency.
        const {
          data: [store],
        } = await query.graph({
          entity: "store",
          fields: [
            "id",
            "supported_currencies.currency_code",
            "supported_currencies.is_default",
          ],
        });
        const currencies = (store.supported_currencies ?? []).filter(Boolean);
        expect(currencies.map((currency) => currency.currency_code)).toEqual([
          "rub",
        ]);
        expect(currencies.every((currency) => currency.is_default)).toBe(true);

        // Exactly one region: "Россия", priced in RUB.
        const { data: regions } = await query.graph({
          entity: "region",
          fields: ["id", "name", "currency_code"],
        });
        expect(regions).toHaveLength(1);
        expect(regions[0].name).toBe("Россия");
        expect(regions[0].currency_code).toBe("rub");
      });
    });

    describe("import-mario-mikke idempotency (ADR-001 upsert contract)", () => {
      it("re-imports the catalog without changing product/variant IDs or resetting inventory", async () => {
        const container = getContainer();
        const query = container.resolve(ContainerRegistrationKeys.QUERY);
        const inventoryModuleService = container.resolve(
          Modules.INVENTORY
        ) as unknown as InventoryModuleLike;

        await seedInitialData({ container });
        await ensureDefaultShippingProfile(container);

        // First import.
        await importMarioMikkeCatalog({ container, args: [] });
        const firstRun = await snapshotCatalog(container);

        expect(firstRun.handles).toHaveLength(12);
        expect(Object.keys(firstRun.variantIdBySku).length).toBeGreaterThan(0);
        // Every managed variant has exactly one inventory item.
        expect(Object.keys(firstRun.inventoryItemIdBySku).length).toBe(
          Object.keys(firstRun.variantIdBySku).length
        );

        // Simulate a merchant stock adjustment on an existing variant so we can
        // prove the re-import preserves inventory rather than resetting it to the
        // catalog default (25). A plain re-run that recreates products would drop
        // this value.
        const [sampleSku] = Object.keys(firstRun.inventoryItemIdBySku).sort();
        const sampleInventoryItemId = firstRun.inventoryItemIdBySku[sampleSku];
        const {
          data: [stockLocation],
        } = await query.graph({ entity: "stock_location", fields: ["id"] });
        const SENTINEL_QUANTITY = 7;
        await inventoryModuleService.updateInventoryLevels([
          {
            inventory_item_id: sampleInventoryItemId,
            location_id: stockLocation.id,
            stocked_quantity: SENTINEL_QUANTITY,
          },
        ]);

        // Second import — the ADR-001 upsert must reconcile the catalog in place.
        await importMarioMikkeCatalog({ container, args: [] });
        const secondRun = await snapshotCatalog(container);

        // Same set of product handles across runs.
        expect([...secondRun.handles].sort()).toEqual(
          [...firstRun.handles].sort()
        );
        // Product IDs are preserved per handle (no delete/recreate).
        expect(secondRun.productIdByHandle).toEqual(firstRun.productIdByHandle);
        // Variant IDs are preserved per SKU.
        expect(secondRun.variantIdBySku).toEqual(firstRun.variantIdBySku);
        // Inventory items are preserved per SKU (not recreated).
        expect(secondRun.inventoryItemIdBySku).toEqual(
          firstRun.inventoryItemIdBySku
        );

        // The merchant's stock adjustment survived the re-import.
        const levels = await inventoryModuleService.listInventoryLevels({
          inventory_item_id: [sampleInventoryItemId],
        });
        const sampleLevel = levels.find(
          (level) => level.location_id === stockLocation.id
        );
        expect(sampleLevel?.stocked_quantity).toBe(SENTINEL_QUANTITY);
      });
    });

    describe("Store API catalog smoke test", () => {
      it("serves the imported catalog from GET /store/products with a publishable key", async () => {
        const container = getContainer();
        const query = container.resolve(ContainerRegistrationKeys.QUERY);

        await seedInitialData({ container });
        await ensureDefaultShippingProfile(container);
        await importMarioMikkeCatalog({ container, args: [] });

        const { data: apiKeys } = await query.graph({
          entity: "api_key",
          fields: ["id", "token", "type", "title"],
        });
        const publishableKey = apiKeys.find(
          (key) => key.type === "publishable"
        );
        expect(publishableKey).toBeTruthy();

        const response = await api.get("/store/products", {
          headers: { "x-publishable-api-key": publishableKey.token },
          params: { limit: 100 },
        });

        expect(response.status).toBe(200);
        const products = response.data.products;
        expect(Array.isArray(products)).toBe(true);
        expect(products).toHaveLength(12);

        const handles = products.map((product) => product.handle);
        for (let id = 1; id <= 12; id++) {
          expect(handles).toContain(`mario-mikke-${id}`);
        }
      });
    });
  },
});
