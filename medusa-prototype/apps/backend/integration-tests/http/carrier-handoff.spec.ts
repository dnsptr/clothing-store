import { medusaIntegrationTestRunner } from "@medusajs/test-utils";
import type { AxiosInstance } from "axios";
import { ContainerRegistrationKeys, generateJwtToken, Modules, ProductStatus } from "@medusajs/framework/utils";
import type { ConfigModule, IInventoryService, IPaymentModuleService, IUserModuleService } from "@medusajs/framework/types";
import {
  createProductsWorkflow,
  createShippingOptionsWorkflow,
  createShippingProfilesWorkflow,
  updateStockLocationsWorkflow,
} from "@medusajs/medusa/core-flows";

import seedInitialData from "../../src/migration-scripts/initial-data-seed";
import type { HandoffOrigin, HandoffRegistry } from "../../src/lib/carrier-handoff";
import { CDEK_FULFILLMENT_PROVIDER_ID, YANDEX_FULFILLMENT_PROVIDER_ID } from "../../src/modules/cdek/shipping-options";
import { CDEK_OPTION_PVZ } from "../../src/modules/cdek/provider-id";
import { YANDEX_OPTION_PVZ } from "../../src/modules/yandex-delivery/provider-id";

jest.setTimeout(300000);

// Only the isolated PostgreSQL runner uses the internal system payment fixture.
// The public Store payment-session endpoint must continue rejecting that provider.
const describeCarriers = process.env.CDEK_ENABLED === "true" && process.env.YANDEX_DELIVERY_ENABLED === "true"
  ? describe : describe.skip;
const CDEK_FIRST_CITY = 990001;
const CDEK_SECOND_CITY = 990002;
const DESTINATION_CITY = 990003;
const destination = { name: "Fixture destination", address: "Synthetic destination street, 3", city: "Fixture city" };
const measurements = [
  { weight: 700, length: 30, width: 25, height: 10 },
  { weight: 350, length: 20, width: 15, height: 5 },
];

function registryFixture(): HandoffRegistry {
  return {
    cdek: {
      default_id: "TEST-CDEK-SOURCE-A",
      points: [
        { id: "TEST-CDEK-SOURCE-A", name: "CDEK fixture A", address: "Synthetic origin A, 1", active: true, city_code: CDEK_FIRST_CITY },
        { id: "TEST-CDEK-SOURCE-B", name: "CDEK fixture B", address: "Synthetic origin B, 2", active: true, city_code: CDEK_SECOND_CITY },
      ],
    },
    yandex: {
      default_id: "TEST-YANDEX-SOURCE-A",
      points: [
        { id: "TEST-YANDEX-SOURCE-A", name: "Yandex fixture A", address: "Synthetic origin A, 1", active: true },
        { id: "TEST-YANDEX-SOURCE-B", name: "Yandex fixture B", address: "Synthetic origin B, 2", active: true },
      ],
    },
  };
}

function originOf(carrier: "cdek" | "yandex", point: NonNullable<HandoffRegistry["cdek"]>["points"][number]): HandoffOrigin {
  const { active: _active, ...snapshot } = point;
  return { carrier, ...snapshot };
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("Expected carrier JSON object");
  return value as Record<string, unknown>;
}

type CarrierRequest = { path: string; body: Record<string, unknown> };
type Method = { shipping_option_id: string; amount: number; data: Record<string, unknown> };
type CartResponse = { cart: { id: string; total: number; shipping_total: number; shipping_methods: Method[] }; cart_access_token: string };
type FulfillmentSnapshot = { id: string; location_id: string; provider_id: string; data: Record<string, unknown> };
type OrderResponse = { order: { id: string; items: Array<{ id: string; quantity: number }>; shipping_methods: Method[]; fulfillments: FulfillmentSnapshot[] } };
type RegistryResponse = { locations: Array<{ id: string; name: string; has_address: boolean; registry: HandoffRegistry }>; count: number };

function carrierTransport() {
  const requests: CarrierRequest[] = [];
  const actualFetch = global.fetch.bind(global);
  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  const spy = jest.spyOn(global, "fetch").mockImplementation(async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const cdek = ["api.cdek.ru", "api.edu.cdek.ru"].includes(url.hostname);
    const yandex = ["b2b-authproxy.taxi.yandex.net", "b2b.taxi.tst.yandex.net"].includes(url.hostname);
    // Native HTTP and other local infrastructure must never be replaced by an echo mock.
    if (!cdek && !yandex) return actualFetch(input, init);
    if (cdek && url.pathname === "/v2/oauth/token") return json({ access_token: "isolated-carrier-token", expires_in: 3600 });
    const body = init?.body ? record(JSON.parse(String(init.body)) as unknown) : {};
    requests.push({ path: url.pathname, body });
    if (cdek && url.pathname === "/v2/deliverypoints") {
      const reception = url.searchParams.get("is_reception") === "true";
      const code = reception ? url.searchParams.get("code") : "TEST-CDEK-DESTINATION";
      const cityCode = Number(url.searchParams.get("city_code"));
      if (reception && !["TEST-CDEK-SOURCE-A", "TEST-CDEK-SOURCE-B"].includes(code ?? "")) {
        throw new Error("Unexpected CDEK origin lookup");
      }
      return json([{
        code, name: destination.name, type: "PVZ", is_reception: reception,
        location: { city_code: cityCode, city: destination.city, address: destination.address }, work_time: "09:00-18:00",
      }]);
    }
    if (cdek && url.pathname === "/v2/calculator/tariff") {
      const source = record(body.from_location).code;
      if (![CDEK_FIRST_CITY, CDEK_SECOND_CITY].includes(Number(source))) throw new Error("Unexpected CDEK source city");
      return json({ delivery_sum: source === CDEK_SECOND_CITY ? 620 : 410, period_min: 2, period_max: 4 });
    }
    if (cdek && url.pathname === "/v2/orders") return json({
      entity: { uuid: "test-cdek-booking" },
      requests: [{ request_uuid: "test-cdek-request", type: "CREATE", state: "ACCEPTED", date_time: "2026-01-01T00:00:00Z" }],
    });
    if (yandex && url.pathname.endsWith("/pickup-points/list")) return json({ points: [{
      id: "TEST-YANDEX-DESTINATION", name: destination.name, type: "pickup_point", operator_id: "market_l4g",
      position: { latitude: 0, longitude: 0 },
      address: { full_address: destination.address, city: destination.city, geo_id: DESTINATION_CITY },
    }] });
    if (yandex && url.pathname.endsWith("/pricing-calculator")) {
      const source = record(body.source).platform_station_id;
      if (!["TEST-YANDEX-SOURCE-A", "TEST-YANDEX-SOURCE-B"].includes(String(source))) throw new Error("Unexpected Yandex source station");
      return json({ pricing_total: `${source === "TEST-YANDEX-SOURCE-B" ? 620 : 410}.00 RUB`, delivery_days: 3 });
    }
    if (yandex && url.pathname.endsWith("/offers/create")) return json({ offers: [{ offer_id: "test-yandex-offer" }] });
    if (yandex && url.pathname.endsWith("/offers/confirm")) return json({ request_id: "test-yandex-request" });
    throw new Error(`Unexpected carrier transport request: ${url}`);
  });
  return { requests, restore: () => spy.mockRestore() };
}

describeCarriers("Carrier handoff origins through native HTTP and PostgreSQL (offline carriers)", () => {
  medusaIntegrationTestRunner({
    testSuite: ({ api: runnerApi, getContainer }) => {
      const api: AxiosInstance = runnerApi;
      async function warehouseFixture() {
        const container = getContainer();
        await seedInitialData({ container });
        const query = container.resolve(ContainerRegistrationKeys.QUERY);
        const { data: [location] } = await query.graph({ entity: "stock_location", fields: ["id", "name"] });
        await updateStockLocationsWorkflow(container).run({ input: {
          selector: { id: location.id },
          update: { address: {
            address_1: "Native inventory warehouse, 10", address_2: "Suite 2", city: "Fixture warehouse city", country_code: "ru",
            postal_code: "000000", phone: "+79990000001", metadata: { fixture_note: "preserve-address-metadata" },
          } },
        } });
        const config = container.resolve<ConfigModule>(ContainerRegistrationKeys.CONFIG_MODULE);
        const users = container.resolve<IUserModuleService>(Modules.USER);
        const manager = await users.createUsers({ email: "dispatch-manager@example.test" });
        const token = generateJwtToken({
          actor_id: manager.id, actor_type: "user", auth_identity_id: "dispatch-manager-fixture",
        }, { secret: config.projectConfig.http.jwtSecret, expiresIn: "5m" });
        const headers = { authorization: `Bearer ${token}` };
        const registry = registryFixture();
        const saved = await api.post<{ location: { registry: HandoffRegistry } }>(`/admin/dispatch-points/${location.id}`, { registry }, { headers });
        expect(saved.status).toBe(200);
        expect(saved.data.location.registry).toEqual(registry);
        return { container, query, location, headers, registry };
      }

      it("authenticates registry reads/writes and rejects invalid defaults/duplicate IDs without replacing the native address", async () => {
        const { query, location, headers, registry } = await warehouseFixture();
        const unauthenticatedRead = await api.get("/admin/dispatch-points", { validateStatus: () => true });
        const unauthenticatedWrite = await api.post(`/admin/dispatch-points/${location.id}`, { registry: {} }, { validateStatus: () => true });
        expect(unauthenticatedRead.status).toBe(401);
        expect(unauthenticatedWrite.status).toBe(401);
        const before = await query.graph({ entity: "stock_location", fields: ["id", "address.*"], filters: { id: location.id } });
        const invalidDefault = registryFixture();
        invalidDefault.cdek!.default_id = "NOT-ALLOWLISTED";
        const duplicateIds = registryFixture();
        duplicateIds.yandex!.points.push({ ...duplicateIds.yandex!.points[0] });
        for (const invalid of [invalidDefault, duplicateIds]) {
          const rejected = await api.post(`/admin/dispatch-points/${location.id}`, { registry: invalid }, { headers, validateStatus: () => true });
          expect(rejected.status).toBe(400);
        }
        const after = await query.graph({ entity: "stock_location", fields: ["id", "address.*"], filters: { id: location.id } });
        expect(after.data).toEqual(before.data);
        expect(after.data[0].address).toMatchObject({
          address_1: "Native inventory warehouse, 10", address_2: "Suite 2", city: "Fixture warehouse city",
          postal_code: "000000", phone: "+79990000001",
          metadata: { fixture_note: "preserve-address-metadata", carrier_handoff: registry },
        });
        const listed = await api.get<RegistryResponse>("/admin/dispatch-points", { headers });
        expect(listed.data.count).toBe(1);
        expect(listed.data.locations).toEqual([{ id: location.id, name: location.name, has_address: true, registry }]);
      });

      it.each(["cdek", "yandex"] as const)("books %s from the fresh staff-selected origin and preserves the paid order and immutable shipment snapshot", async (carrier) => {
        const transport = carrierTransport();
        try {
          const { container, query, location, headers: adminHeaders, registry } = await warehouseFixture();
          const providerId = carrier === "cdek" ? CDEK_FULFILLMENT_PROVIDER_ID : YANDEX_FULFILLMENT_PROVIDER_ID;
          const optionCode = carrier === "cdek" ? CDEK_OPTION_PVZ : YANDEX_OPTION_PVZ;
          const group = registry[carrier]!;
          const checkoutOrigin = originOf(carrier, group.points[0]);
          const link = container.resolve(ContainerRegistrationKeys.LINK);
          await link.create({
            [Modules.STOCK_LOCATION]: { stock_location_id: location.id },
            [Modules.FULFILLMENT]: { fulfillment_provider_id: providerId },
          });
          const { result: [profile] } = await createShippingProfilesWorkflow(container).run({ input: { data: [{ name: "Carrier fixture", type: "default" }] } });
          const { data: [region] } = await query.graph({ entity: "region", fields: ["id"] });
          const { data: [channel] } = await query.graph({ entity: "sales_channel", fields: ["id"] });
          const { data: [set] } = await query.graph({ entity: "fulfillment_set", fields: ["service_zones.id"] });
          const { data: [key] } = await query.graph({ entity: "api_key", fields: ["token"], filters: { type: "publishable" } });
          const { result: [product] } = await createProductsWorkflow(container).run({ input: { products: [{
            title: "Measured carrier fixture", status: ProductStatus.PUBLISHED, shipping_profile_id: profile.id,
            sales_channels: [{ id: channel.id }], options: [{ title: "Size", values: ["M", "S"] }],
            variants: measurements.map((dimensions, index) => ({
              title: index === 0 ? "M" : "S", sku: `handoff-${carrier}-${index}`, options: { Size: index === 0 ? "M" : "S" },
              ...dimensions, prices: [{ currency_code: "rub", amount: index === 0 ? 1899 : 999 }], manage_inventory: true,
            })),
          }] } });
          const { data: [storedProduct] } = await query.graph({
            entity: "product", fields: ["variants.id", "variants.inventory_items.inventory_item_id"], filters: { id: product.id },
          });
          const inventory = container.resolve<IInventoryService>(Modules.INVENTORY);
          for (const variant of storedProduct.variants) await inventory.createInventoryLevels({
            inventory_item_id: variant.inventory_items[0].inventory_item_id, location_id: location.id, stocked_quantity: 1,
          });
          const { result: [option] } = await createShippingOptionsWorkflow(container).run({ input: [{
            name: `Fixture ${carrier} pickup`, price_type: "calculated", provider_id: providerId,
            service_zone_id: set.service_zones[0].id, shipping_profile_id: profile.id,
            type: { label: "Fixture pickup", description: "Isolated carrier transport", code: optionCode }, data: { id: optionCode },
            rules: [{ attribute: "enabled_in_store", value: "true", operator: "eq" }, { attribute: "is_return", value: "false", operator: "eq" }],
          }] });
          const created = await api.post<CartResponse>("/store/carts", { region_id: region.id }, { headers: { "x-publishable-api-key": key.token } });
          const cartId = created.data.cart.id;
          const headers = { "x-publishable-api-key": key.token, "x-cart-access-token": created.data.cart_access_token };
          for (const variant of storedProduct.variants) await api.post(`/store/carts/${cartId}/line-items`, { variant_id: variant.id, quantity: 1 }, { headers });
          await api.post(`/store/carts/${cartId}`, {
            email: "carrier-buyer@example.test", metadata: { delivery_type: optionCode },
            shipping_address: { first_name: "Fixture", last_name: "Buyer", phone: "+79990000002", country_code: "ru", address_1: destination.address, city: destination.city, postal_code: "000000" },
          }, { headers });
          const selection = carrier === "cdek"
            ? { city_code: DESTINATION_CITY, cdek_pvz_code: "TEST-CDEK-DESTINATION" }
            : { geo_id: DESTINATION_CITY, platform_station_id: "TEST-YANDEX-DESTINATION", pvz_name: destination.name, pvz_address: destination.address, city: destination.city };
          const calculated = await api.post<{ shipping_option: { amount: number } }>(`/store/shipping-options/${option.id}/calculate`, { cart_id: cartId, data: selection }, { headers });
          const buyerFee = Number(carrier === "cdek" ? process.env.CDEK_PVZ_PRICE_RUB : process.env.YANDEX_DELIVERY_PVZ_PRICE_RUB);
          expect(calculated.data.shipping_option.amount).toBe(buyerFee);
          const shipped = await api.post<CartResponse>(`/store/carts/${cartId}/shipping-methods`, { option_id: option.id, data: selection }, { headers, params: { fields: "+shipping_methods.data" } });
          const shippingData = shipped.data.cart.shipping_methods[0].data;
          expect(shippingData.handoff_origin).toEqual(checkoutOrigin);
          expect(shippingData.carrier_quote_amount).toBe(410);
          expect(shippingData.carrier_quote_currency).toBe("RUB");
          expect(Number(shipped.data.cart.shipping_total)).toBe(buyerFee);
          if (carrier === "cdek") {
            expect(shippingData.validated_packages).toEqual(expect.arrayContaining(measurements.map((dimensions) => expect.objectContaining(dimensions))));
            expect(shippingData.validated_packages).toHaveLength(2);
          } else {
            expect(shippingData.package_manifest).toEqual(expect.arrayContaining(measurements.map((dimensions) => expect.objectContaining({ measurements: dimensions, quantity: 1 }))));
            expect(shippingData.package_manifest).toHaveLength(2);
          }
          const collection = await api.post<{ payment_collection: { id: string } }>("/store/payment-collections", { cart_id: cartId }, { headers });
          const collectionId = collection.data.payment_collection.id;
          const forbiddenFree = await api.post(`/store/payment-collections/${collectionId}/payment-sessions`, { provider_id: "pp_system_default" }, { headers, validateStatus: () => true });
          expect(forbiddenFree.status).toBe(400);
          // Fixture-only internal authorization/capture: no real bank or public free-payment bypass.
          // Native completion also validates provider-region membership. This link
          // exists only inside the isolated fixture; public creation was rejected above.
          await link.create({
            [Modules.REGION]: { region_id: region.id },
            [Modules.PAYMENT]: { payment_provider_id: "pp_system_default" },
          });
          const paymentModule = container.resolve<IPaymentModuleService>(Modules.PAYMENT);
          const session = await paymentModule.createPaymentSession(collectionId, {
            provider_id: "pp_system_default", currency_code: "rub", amount: Number(shipped.data.cart.total), data: {},
          });
          const payment = await paymentModule.authorizePaymentSession(session.id, {});
          if (!payment) throw new Error("System fixture payment was not authorized");
          await paymentModule.capturePayment({ payment_id: payment.id });
          const completed = await api.post<{ type: string; order: { id: string } }>(`/store/carts/${cartId}/complete`, {}, { headers });
          expect(completed.data.type).toBe("order");
          const orderId = completed.data.order.id;
          const orderQuery = { fields: "+fulfillments.*,+shipping_methods.data" };
          const nativeOrder = await api.get<OrderResponse>(`/admin/orders/${orderId}`, { headers: adminHeaders, params: orderQuery });
          expect(nativeOrder.data.order.items).toHaveLength(2);
          expect(nativeOrder.data.order.shipping_methods[0].data).toEqual(shippingData);
          const items = nativeOrder.data.order.items.map((item) => ({ id: item.id, quantity: item.quantity }));

          // Disable the paid source, change the default and update the alternate's
          // address after checkout. Fulfillment must use fresh native location metadata.
          group.points[0].active = false;
          group.default_id = group.points[1].id;
          group.points[1].name = "Fresh staff alternate";
          group.points[1].address = "Fresh alternate address, 22";
          await api.post(`/admin/dispatch-points/${location.id}`, { registry }, { headers: adminHeaders });
          const dispatch = await api.get<{ carrier: string; location_id: string; shipping_option_id: string; default_id: string; origin: HandoffOrigin; points: typeof group.points }>(`/admin/orders/${orderId}/dispatch-points`, { headers: adminHeaders });
          expect(dispatch.data).toMatchObject({ carrier, location_id: location.id, shipping_option_id: option.id, default_id: group.default_id, origin: checkoutOrigin });
          expect(dispatch.data.points).toEqual([group.points[1]]);
          const start = transport.requests.length;
          const forgedLocation = { id: location.id, address: { metadata: { carrier_handoff: {
            [carrier]: { default_id: "NOT-ALLOWLISTED", points: [{ ...group.points[1], id: "NOT-ALLOWLISTED" }] },
          } } } };
          for (const additionalData of [undefined, { dispatch_point_id: "NOT-ALLOWLISTED", handoff_location: forgedLocation }, { dispatch_point_id: group.points[0].id }]) {
            const rejected = await api.post(`/admin/orders/${orderId}/fulfillments`, {
              items, location_id: additionalData === undefined ? undefined : location.id, shipping_option_id: option.id, additional_data: additionalData,
            }, { headers: adminHeaders, validateStatus: () => true });
            expect(rejected.status).toBe(400);
          }
          expect(transport.requests).toHaveLength(start);
          const unfulfilled = await api.get<OrderResponse>(`/admin/orders/${orderId}`, { headers: adminHeaders, params: orderQuery });
          expect(unfulfilled.data.order.fulfillments).toEqual([]);
          const alternateOrigin = originOf(carrier, group.points[1]);
          const fulfilled = await api.post<OrderResponse>(`/admin/orders/${orderId}/fulfillments`, {
            items, location_id: carrier === "cdek" ? location.id : undefined, shipping_option_id: option.id,
            additional_data: { dispatch_point_id: group.points[1].id },
          }, { headers: adminHeaders, params: orderQuery });
          expect(fulfilled.status).toBe(200);
          expect(fulfilled.data.order.fulfillments).toHaveLength(1);
          const snapshot = fulfilled.data.order.fulfillments[0];
          expect(snapshot).toMatchObject({ location_id: location.id, provider_id: providerId });
          expect(snapshot.data).toMatchObject({ handoff_origin: alternateOrigin, carrier_quote_amount: 620, carrier_quote_currency: "RUB" });
          const outgoing = transport.requests.slice(start);
          if (carrier === "cdek") {
            const quote = outgoing.find((request) => request.path.endsWith("/calculator/tariff"));
            expect(quote?.body).toMatchObject({ from_location: { code: CDEK_SECOND_CITY }, to_location: { code: DESTINATION_CITY }, tariff_code: 136, packages: expect.arrayContaining(measurements.map((dimensions) => expect.objectContaining(dimensions))) });
            const bookings = outgoing.filter((request) => request.path.endsWith("/orders"));
            expect(bookings).toHaveLength(1);
            expect(bookings[0].body).toMatchObject({ shipment_point: alternateOrigin.id, delivery_point: "TEST-CDEK-DESTINATION", delivery_recipient_cost: { value: 0 } });
            expect(bookings[0].body.packages).toEqual(expect.arrayContaining(measurements.map((dimensions, index) => expect.objectContaining({
              ...dimensions, items: [expect.objectContaining({ amount: 1, payment: { value: 0 }, cost: index === 0 ? 1899 : 999 })],
            }))));
            expect(snapshot.data.cdek_uuid).toBe("test-cdek-booking");
          } else {
            const quote = outgoing.find((request) => request.path.endsWith("/pricing-calculator"));
            expect(quote?.body).toMatchObject({ source: { platform_station_id: alternateOrigin.id }, destination: { platform_station_id: "TEST-YANDEX-DESTINATION" }, total_weight: 1050, total_assessed_price: 289800, payment_method: "already_paid" });
            const bookings = outgoing.filter((request) => request.path.endsWith("/offers/create"));
            expect(bookings).toHaveLength(1);
            expect(bookings[0].body).toMatchObject({ source: { platform_station: { platform_id: alternateOrigin.id } }, destination: { platform_station: { platform_id: "TEST-YANDEX-DESTINATION" } }, billing_info: { payment_method: "already_paid", delivery_cost: 0 } });
            expect(bookings[0].body.places).toEqual(expect.arrayContaining(measurements.map((dimensions) => expect.objectContaining({ physical_dims: { weight_gross: dimensions.weight, dx: dimensions.length, dy: dimensions.width, dz: dimensions.height } }))));
            expect(bookings[0].body.items).toEqual(expect.arrayContaining([189900, 99900].map((price) => expect.objectContaining({ count: 1, billing_details: { unit_price: price, assessed_unit_price: price } }))));
            expect(outgoing.filter((request) => request.path.endsWith("/offers/confirm")).map((request) => request.body)).toEqual([{ offer_id: "test-yandex-offer" }]);
            expect(snapshot.data.yandex_request_id).toBe("test-yandex-request");
          }
          expect(Number(fulfilled.data.order.shipping_methods[0].amount)).toBe(buyerFee);
          expect(fulfilled.data.order.shipping_methods[0].data.handoff_origin).toEqual(checkoutOrigin);
          group.points[0].active = true;
          group.default_id = group.points[0].id;
          group.points[1].address = "Changed after booking, 99";
          await api.post(`/admin/dispatch-points/${location.id}`, { registry }, { headers: adminHeaders });
          const reread = await api.get<OrderResponse>(`/admin/orders/${orderId}`, { headers: adminHeaders, params: orderQuery });
          expect(reread.data.order.fulfillments[0]).toEqual(snapshot);
          expect(reread.data.order.shipping_methods[0].data).toEqual(shippingData);
          const persisted = await query.graph({ entity: "fulfillment", fields: ["id", "data", "location_id"], filters: { id: snapshot.id } });
          expect(persisted.data[0]).toMatchObject({ id: snapshot.id, location_id: location.id, data: snapshot.data });
          const locations = await api.get<RegistryResponse>("/admin/dispatch-points", { headers: adminHeaders });
          expect(locations.data.count).toBe(1);
        } finally {
          transport.restore();
        }
      });
    },
  });
});
