import { setTimeout as delay } from "node:timers/promises";
import { medusaIntegrationTestRunner } from "@medusajs/test-utils";
import { ContainerRegistrationKeys, generateJwtToken, Modules, ProductStatus } from "@medusajs/framework/utils";
import type { ConfigModule, IUserModuleService } from "@medusajs/framework/types";
import {
  createProductsWorkflow,
  createShippingOptionsWorkflow,
  createShippingProfilesWorkflow,
} from "@medusajs/medusa/core-flows";

import seedInitialData from "../../src/migration-scripts/initial-data-seed";
import { TBANK_NOTIFICATION_MODULE } from "../../src/modules/tbank-notifications";
import { generateToken } from "../../src/modules/tbank/lib/token";

jest.setTimeout(300000);

const describeTbank = process.env.TBANK_ENABLED === "true" ? describe : describe.skip;

describeTbank("T-Bank checkout with PostgreSQL (offline bank)", () => {
  medusaIntegrationTestRunner({
    testSuite: ({ api, getContainer }) => {
      it("excludes the free system provider and restores T-Bank on an existing RU region", async () => {
        const container = getContainer();
        const query = container.resolve(ContainerRegistrationKeys.QUERY);
        await seedInitialData({ container });
        const { data: [region] } = await query.graph({
          entity: "region", fields: ["id", "currency_code", "payment_providers.id"],
        });
        expect(region.payment_providers?.map((provider) => provider?.id)).toEqual(["pp_tbank_tbank"]);
        const link = container.resolve(ContainerRegistrationKeys.LINK);
        // Simulate a region seeded before the paid provider was enabled.
        await link.create({
          [Modules.REGION]: { region_id: region.id },
          [Modules.PAYMENT]: { payment_provider_id: "pp_system_default" },
        });
        await link.dismiss({
          [Modules.REGION]: { region_id: region.id },
          [Modules.PAYMENT]: { payment_provider_id: "pp_tbank_tbank" },
        });
        await seedInitialData({ container });
        await seedInitialData({ container });
        const { data: [key] } = await query.graph({ entity: "api_key", fields: ["token", "type"], filters: { type: "publishable" } });
        const response = await api.get("/store/payment-providers", {
          headers: { "x-publishable-api-key": key.token },
          params: { region_id: region.id },
        });
        expect(response.status).toBe(200);
        const providerIds = response.data.payment_providers.map((provider: { id: string }) => provider.id);
        expect(providerIds).not.toContain("pp_system_default");
        expect(providerIds.filter((id: string) => id === "pp_tbank_tbank")).toHaveLength(1);
      });

      it("rejects a different guest cart capability without exposing or modifying customer details", async () => {
        const container = getContainer();
        const query = container.resolve(ContainerRegistrationKeys.QUERY);
        await seedInitialData({ container });
        const { data: [region] } = await query.graph({ entity: "region", fields: ["id"] });
        const { data: [key] } = await query.graph({ entity: "api_key", fields: ["token"], filters: { type: "publishable" } });
        const publicHeaders = { "x-publishable-api-key": key.token };
        const first = await api.post("/store/carts", { region_id: region.id, email: "owner@example.test" }, { headers: publicHeaders });
        const second = await api.post("/store/carts", { region_id: region.id }, { headers: publicHeaders });
        const cartId = first.data.cart.id;
        const foreignHeaders = { ...publicHeaders, "x-cart-access-token": second.data.cart_access_token };
        const ownerHeaders = { ...publicHeaders, "x-cart-access-token": first.data.cart_access_token };
        const anonymous = await api.get(`/store/carts/${cartId}`, { headers: publicHeaders, validateStatus: () => true });
        expect(anonymous.status).toBe(404);
        expect(anonymous.data.cart).toBeUndefined();
        const tampered = await api.post(`/store/carts/${cartId}`, { email: "attacker@example.test" }, {
          headers: foreignHeaders, validateStatus: () => true,
        });
        expect(tampered.status).toBe(404);
        const owner = await api.get(`/store/carts/${cartId}`, { headers: ownerHeaders });
        expect(owner.data.cart.email).toBe("owner@example.test");
        expect(owner.headers["cache-control"]).toBe("no-store");
      });

      it("does not copy another cart address through public address identifiers", async () => {
        const container = getContainer();
        const query = container.resolve(ContainerRegistrationKeys.QUERY);
        await seedInitialData({ container });
        const { data: [region] } = await query.graph({ entity: "region", fields: ["id"] });
        const { data: [key] } = await query.graph({ entity: "api_key", fields: ["token"], filters: { type: "publishable" } });
        const publicHeaders = { "x-publishable-api-key": key.token };
        const address = { first_name: "Владелец", address_1: "Закрытый адрес, 1", country_code: "ru" };
        const privateCart = await api.post("/store/carts", { region_id: region.id, shipping_address: address }, { headers: publicHeaders });
        const foreignAddressId = privateCart.data.cart.shipping_address.id;
        const createProbe = await api.post("/store/carts", {
          region_id: region.id, shipping_address: foreignAddressId,
        }, { headers: publicHeaders, validateStatus: () => true });
        expect(createProbe.status).toBe(400);
        expect(createProbe.data.cart).toBeUndefined();
        const ownCart = await api.post("/store/carts", {
          region_id: region.id, shipping_address: { ...address, address_1: "Мой адрес, 2" },
        }, { headers: publicHeaders });
        const headers = { ...publicHeaders, "x-cart-access-token": ownCart.data.cart_access_token };
        const updateProbe = await api.post(`/store/carts/${ownCart.data.cart.id}`, {
          billing_address: foreignAddressId,
        }, { headers, validateStatus: () => true });
        expect(updateProbe.status).toBe(400);
        const unchanged = await api.get(`/store/carts/${ownCart.data.cart.id}`, { headers });
        expect(unchanged.data.cart.shipping_address.address_1).toBe("Мой адрес, 2");
        expect(unchanged.data.cart.billing_address?.address_1).not.toBe(address.address_1);
      });

      it("rejects active uploads and disguised HTML while serving supported images as images", async () => {
        const container = getContainer();
        const config = container.resolve<ConfigModule>(ContainerRegistrationKeys.CONFIG_MODULE);
        const users = container.resolve<IUserModuleService>(Modules.USER);
        const admin = await users.createUsers({ email: "upload-security@example.test" });
        const token = generateJwtToken({
          actor_id: admin.id, actor_type: "user", auth_identity_id: "upload-security-fixture",
        }, { secret: config.projectConfig.http.jwtSecret, expiresIn: "5m" });
        const headers = { authorization: `Bearer ${token}` };
        for (const [filename, type] of [["active.svg", "image/svg+xml"], ["disguised.png", "image/png"]]) {
          const form = new FormData();
          form.append("files", new Blob(["<svg><script>window.test=true</script></svg>"], { type }), filename);
          const response = await api.post("/admin/uploads", form, { headers, validateStatus: () => true });
          expect(response.status).toBe(400);
          expect(response.data.files).toBeUndefined();
        }
        const form = new FormData();
        form.append("files", new Blob([Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64",
        )], { type: "image/png" }), "passive.png");
        const uploaded = await api.post("/admin/uploads", form, { headers });
        const file = uploaded.data.files[0];
        try {
          const served = await api.get(new URL(file.url).pathname);
          expect(served.headers["content-type"]).toMatch(/^image\/png(?:;|$)/);
        } finally {
          await api.delete(`/admin/uploads/${encodeURIComponent(file.id)}`, { headers });
        }
      });


      it("creates and captures one order after a signed CONFIRMED webhook is replayed", async () => {
        const container = getContainer();
        const query = container.resolve(ContainerRegistrationKeys.QUERY);
        await seedInitialData({ container });
        await createShippingProfilesWorkflow(container).run({
          input: { data: [{ name: "Checkout fixture", type: "default" }] },
        });
        const { data: [region] } = await query.graph({
          entity: "region", fields: ["id", "currency_code"],
        });
        const { data: [salesChannel] } = await query.graph({
          entity: "sales_channel", fields: ["id"],
        });
        const { data: [shippingProfile] } = await query.graph({
          entity: "shipping_profile", fields: ["id"],
        });
        const { data: [fulfillmentSet] } = await query.graph({
          entity: "fulfillment_set", fields: ["service_zones.id"],
        });
        const { data: [key] } = await query.graph({
          entity: "api_key", fields: ["token"], filters: { type: "publishable" },
        });
        const headers: Record<string, string> = { "x-publishable-api-key": key.token };

        const { result: [product] } = await createProductsWorkflow(container).run({
          input: {
            products: [{
              title: "Тестовое изделие",
              status: ProductStatus.PUBLISHED,
              shipping_profile_id: shippingProfile.id,
              sales_channels: [{ id: salesChannel.id }],
              options: [{ title: "Размер", values: ["M"] }],
              variants: [{
                title: "M",
                sku: "offline-checkout-fixture",
                options: { Размер: "M" },
                prices: [{ currency_code: "rub", amount: 1899 }],
                manage_inventory: false,
              }],
            }],
          },
        });
        const { data: [storedProduct] } = await query.graph({
          entity: "product",
          fields: ["variants.id"],
          filters: { id: product.id },
        });
        const variantId = storedProduct.variants[0].id;

        const { result: [shippingOption] } = await createShippingOptionsWorkflow(container).run({
          input: [{
            name: "Тестовая доставка",
            price_type: "flat",
            provider_id: "manual_manual",
            service_zone_id: fulfillmentSet.service_zones[0].id,
            shipping_profile_id: shippingProfile.id,
            type: { label: "Тестовая доставка", description: "Только для изолированной БД", code: "checkout-fixture" },
            prices: [{ currency_code: "rub", amount: 250 }],
            rules: [
              { attribute: "enabled_in_store", value: "true", operator: "eq" },
              { attribute: "is_return", value: "false", operator: "eq" },
            ],
          }],
        });

        let bankStatus = "NEW";
        const bankPaymentId = "3456789";
        const bankRequest = jest.spyOn(global, "fetch").mockImplementation(async (url, options) => {
          const requestUrl = String(url);
          if (!requestUrl.startsWith("https://rest-api-test.tinkoff.ru/v2/")) {
            throw new Error(`Unexpected external request: ${requestUrl}`);
          }
          const request = JSON.parse(String(options?.body)) as { Amount?: number; OrderId?: string };
          const method = requestUrl.slice(requestUrl.lastIndexOf("/") + 1);
          if (method !== "Init" && method !== "GetState") {
            throw new Error(`Unexpected bank operation: ${method}`);
          }
          return {
            ok: true,
            status: 200,
            json: async () => ({
              Success: true,
              ErrorCode: "0",
              PaymentId: bankPaymentId,
              PaymentURL: "https://rest-api-test.tinkoff.ru/offline-checkout",
              Status: bankStatus,
              ...(request.Amount === undefined ? {} : { Amount: request.Amount }),
              ...(request.OrderId === undefined ? {} : { OrderId: request.OrderId }),
            }),
          } as Response;
        });
        try {
          const cartResponse = await api.post("/store/carts", { region_id: region.id }, { headers });
          const cartId = cartResponse.data.cart.id as string;
          headers["x-cart-access-token"] = cartResponse.data.cart_access_token;
          await api.post(`/store/carts/${cartId}/line-items`, { variant_id: variantId, quantity: 1 }, { headers });
          await api.post(`/store/carts/${cartId}`, {
            email: "checkout@example.test",
            shipping_address: {
              first_name: "Тест", last_name: "Покупатель", address_1: "Тестовая, 1",
              city: "Москва", postal_code: "101000", country_code: "ru", phone: "+79991234567",
            },
          }, { headers });
          const shipped = await api.post(`/store/carts/${cartId}/shipping-methods`, {
            option_id: shippingOption.id,
          }, { headers });
          const amountKopecks = Math.round(Number(shipped.data.cart.total) * 100);
          expect(Number(shipped.data.cart.shipping_total)).toBe(250);
          const collection = await api.post("/store/payment-collections", { cart_id: cartId }, { headers });
          const paymentCollectionId = collection.data.payment_collection.id as string;
          const freePayment = await api.post(
            `/store/payment-collections/${paymentCollectionId}/payment-sessions`,
            { provider_id: "pp_system_default" },
            { headers, validateStatus: () => true },
          );
          expect(freePayment.status).toBe(400);
          const initiated = await api.post(
            `/store/payment-collections/${paymentCollectionId}/payment-sessions`,
            { provider_id: "pp_tbank_tbank" },
            { headers },
          );
          const session = initiated.data.payment_collection.payment_sessions.find(
            (item: { provider_id: string }) => item.provider_id === "pp_tbank_tbank",
          );
          expect(session.data.paymentUrl).toBe("https://rest-api-test.tinkoff.ru/offline-checkout");
          const completed = await api.post(`/store/carts/${cartId}/complete`, {}, { headers });
          expect(completed.data.order.id).toBeTruthy();
          const pendingStatus = await api.get(`/store/payment-status/${cartId}`, { headers });
          expect(pendingStatus.data).toEqual({ payment: "pending", order: "pending" });
          expect(completed.data.type).toBe("order");

          bankStatus = "CONFIRMED";
          const notification: Record<string, unknown> = {
            TerminalKey: "TinkoffBankTest",
            OrderId: session.id,
            PaymentId: Number(bankPaymentId),
            Status: "CONFIRMED",
            Amount: amountKopecks,
            Success: true,
          };
          notification.Token = generateToken(notification, "TinkoffBankTest");
          const firstWebhook = await api.post("/hooks/payment/tbank", notification);
          expect(firstWebhook.data).toBe("OK");
          const inbox = container.resolve(TBANK_NOTIFICATION_MODULE) as {
            listTbankNotifications: (filters: Record<string, string>) => Promise<Array<{
              lifecycle_state: string;
            }>>;
            listTbankPaymentAttempts: (filters: Record<string, string>) => Promise<Array<{
              payment_session_id: string; expected_amount_kopecks: number;
            }>>;
          };
          let inboxRows: Awaited<ReturnType<typeof inbox.listTbankNotifications>> = [];
          for (let attempt = 0; attempt < 50; attempt++) {
            inboxRows = await inbox.listTbankNotifications({ payment_id: bankPaymentId, status: "CONFIRMED" });
            if (inboxRows[0]?.lifecycle_state === "processed") break;
            await delay(100);
          }
          expect(inboxRows).toHaveLength(1);
          expect(inboxRows[0].lifecycle_state).toBe("processed");
          const replay = await api.post("/hooks/payment/tbank", notification);
          expect(replay.data).toBe("OK");

          const { data: orders } = await query.graph({
            entity: "order_cart", fields: ["order_id", "cart_id"], filters: { cart_id: cartId },
          });
          const { data: payments } = await query.graph({
            entity: "payment", fields: ["payment_session_id", "captured_at"], filters: { payment_session_id: session.id },
          });
          const status = await api.get(`/store/payment-status/${cartId}`, { headers });
          const attempts = await inbox.listTbankPaymentAttempts({ payment_session_id: session.id });
          expect(attempts).toHaveLength(1);
          expect(attempts[0].expected_amount_kopecks).toBe(amountKopecks);
          expect(orders).toHaveLength(1);
          expect(orders[0].order_id).toBe(completed.data.order.id);
          expect(payments).toHaveLength(1);
          expect(payments[0].captured_at).toBeTruthy();
          expect(status.data).toEqual({ payment: "confirmed", order: "ready" });
          const otherCart = await api.post("/store/carts", { region_id: region.id }, {
            headers: { "x-publishable-api-key": key.token },
          });
          const foreignHeaders = { "x-publishable-api-key": key.token, "x-cart-access-token": otherCart.data.cart_access_token };
          for (const path of [`/store/orders/${orders[0].order_id}`, `/store/payment-status/${cartId}`]) {
            const denied = await api.get(path, { headers: foreignHeaders, validateStatus: () => true });
            expect(denied.status).toBe(404);
            expect(denied.data.order).toBeUndefined();
            expect(denied.data.payment).toBeUndefined();
          }
          const ownedOrder = await api.get(`/store/orders/${orders[0].order_id}`, { headers });
          expect(ownedOrder.data.order.email).toBe("checkout@example.test");
          const deniedSession = await api.post(`/store/payment-collections/${paymentCollectionId}/payment-sessions`, {
            provider_id: "pp_tbank_tbank",
          }, { headers: foreignHeaders, validateStatus: () => true });
          expect(deniedSession.status).toBe(404);
          const storedNotifications = await inbox.listTbankNotifications({ payment_id: bankPaymentId, status: "CONFIRMED" });
          expect(storedNotifications).toHaveLength(1);
          const initCalls = bankRequest.mock.calls.filter(([url]) => String(url).endsWith("/Init"));
          expect(initCalls).toHaveLength(1);
          const request = JSON.parse(String(initCalls[0][1]?.body)) as {
            Amount: number; Receipt: { Taxation: string; Items: Array<{ Name: string; Amount: number; PaymentObject: string }> };
          };
          expect(request.Amount).toBe(amountKopecks);
          expect(request.Receipt.Taxation).toBe("usn_income");
          expect(request.Receipt.Items.reduce((sum, item) => sum + item.Amount, 0)).toBe(amountKopecks);
          expect(request.Receipt.Items).toEqual(expect.arrayContaining([
            expect.objectContaining({ Name: "Доставка", Amount: 25_000, PaymentObject: "service" }),
          ]));
        } finally {
          bankRequest.mockRestore();
        }
      });
    },
  });
});
