import { setTimeout as delay } from "node:timers/promises";
import { medusaIntegrationTestRunner } from "@medusajs/test-utils";
import { ContainerRegistrationKeys, generateJwtToken, Modules, ProductStatus } from "@medusajs/framework/utils";
import type { ConfigModule, IInventoryService, IUserModuleService } from "@medusajs/framework/types";
import { createProductsWorkflow, createShippingOptionsWorkflow, createShippingProfilesWorkflow } from "@medusajs/core-flows";
import seedInitialData from "../../src/migration-scripts/initial-data-seed";
import { generateToken } from "../../src/modules/tbank/lib/token";
import type { RefundPreview, RefundResult } from "../../src/modules/tbank/refund-contracts";

jest.setTimeout(300000);
const describeTbank = process.env.TBANK_ENABLED === "true" ? describe : describe.skip;
const mark = "010460123456789321OFFLINE-UNIT\u001d93ABCD";
type BankState = { id: string; orderId: string; original: number; balance: number; status: string; refunds: Map<string, Record<string, unknown>> };

describeTbank("T-Bank native refunds with PostgreSQL and an isolated bank", () => {
  medusaIntegrationTestRunner({ testSuite: ({ api, getContainer }) => {
    const states = new Map<string, BankState>();
    const calls: Array<{ method: string; body: Record<string, any> }> = [];
    let fetchSpy: jest.SpyInstance;
    let fault: "reject" | "timeout-before" | "timeout-after" | undefined;
    let fiscalSequence = 100;
    let originalBaseUrl: string | undefined;

    beforeEach(() => {
      originalBaseUrl = process.env.TBANK_API_BASE_URL;
      process.env.TBANK_API_BASE_URL = "https://securepay.tinkoff.ru/v2";
      states.clear(); calls.length = 0; fault = undefined; fiscalSequence = 100;
      fetchSpy = jest.spyOn(global, "fetch").mockImplementation(async (input, options) => {
        const url = new URL(String(input));
        if (!["securepay.tinkoff.ru", "rest-api-test.tinkoff.ru"].includes(url.hostname)) throw new Error("Unexpected external request in offline financial test");
        const method = url.pathname.split("/").pop()!;
        const body = JSON.parse(String(options?.body));
        calls.push({ method, body });
        const response = (payload: Record<string, unknown>) => ({ ok: true, status: 200, json: async () => payload }) as Response;
        if (method === "Init") {
          const id = String(7100000 + states.size);
          const state = { id, orderId: body.OrderId, original: body.Amount, balance: body.Amount, status: "NEW", refunds: new Map<string, Record<string, unknown>>() };
          states.set(id, state);
          return response({ Success: true, ErrorCode: "0", PaymentId: id, OrderId: state.orderId,
            TerminalKey: "TinkoffBankTest", Amount: state.balance, Status: state.status,
            PaymentURL: "https://rest-api-test.tinkoff.ru/offline-refund" });
        }
        const state = states.get(String(body.PaymentId));
        if (!state) throw new Error("Unknown isolated bank payment");
        if (method === "GetState") return response({ Success: true, ErrorCode: "0", PaymentId: state.id,
          TerminalKey: "TinkoffBankTest", OrderId: state.orderId, Amount: state.balance, Status: state.status });
        if (method === "SendClosingReceipt") return response({ Success: true, ErrorCode: "0" });
        if (method !== "Cancel") throw new Error(`Unexpected isolated bank method ${method}`);
        const prior = state.refunds.get(body.ExternalRequestId);
        if (prior) return response(prior);
        const thisFault = fault; fault = undefined;
        if (thisFault === "reject") return response({ Success: false, ErrorCode: "4", Message: "Rejected by isolated bank" });
        if (thisFault === "timeout-before") throw new DOMException("Isolated lost request", "AbortError");
        if (!Number.isSafeInteger(body.Amount) || body.Amount <= 0 || body.Amount > state.balance) {
          return response({ Success: false, ErrorCode: "7", Message: "Amount exceeds isolated balance" });
        }
        const before = state.balance;
        state.balance -= body.Amount;
        state.status = state.balance === 0 ? "REFUNDED" : "PARTIAL_REFUNDED";
        const result = { Success: true, ErrorCode: "0", TerminalKey: "TinkoffBankTest", PaymentId: state.id,
          OrderId: state.orderId, Status: state.status, OriginalAmount: before, NewAmount: state.balance,
          ExternalRequestId: body.ExternalRequestId };
        state.refunds.set(body.ExternalRequestId, result);
        if (thisFault === "timeout-after") throw new DOMException("Isolated lost response", "AbortError");
        return response(result);
      });
    });
    afterEach(() => {
      fetchSpy.mockRestore();
      if (originalBaseUrl === undefined) delete process.env.TBANK_API_BASE_URL;
      else process.env.TBANK_API_BASE_URL = originalBaseUrl;
    });

    async function fixture() {
      const container = getContainer();
      const query = container.resolve(ContainerRegistrationKeys.QUERY);
      await seedInitialData({ container });
      await createShippingProfilesWorkflow(container).run({ input: { data: [{ name: "Refund fixture", type: "default" }] } });
      const { data: [region] } = await query.graph({ entity: "region", fields: ["id"] });
      const { data: [channel] } = await query.graph({ entity: "sales_channel", fields: ["id"] });
      const { data: [profile] } = await query.graph({ entity: "shipping_profile", fields: ["id"] });
      const { data: [set] } = await query.graph({ entity: "fulfillment_set", fields: ["service_zones.id"] });
      const { data: [location] } = await query.graph({ entity: "stock_location", fields: ["id"] });
      const { data: [key] } = await query.graph({ entity: "api_key", fields: ["token"], filters: { type: "publishable" } });
      const { result: [product] } = await createProductsWorkflow(container).run({ input: { products: [{
        title: "Изделие для возврата", status: ProductStatus.PUBLISHED, shipping_profile_id: profile.id,
        sales_channels: [{ id: channel.id }], options: [{ title: "Размер", values: ["M"] }],
        variants: [{ title: "M", sku: "offline-refund", options: { Размер: "M" }, weight: 700, length: 30, width: 25, height: 10,
          prices: [{ currency_code: "rub", amount: 1000 }], manage_inventory: true }],
      }] } });
      const { data: [stored] } = await query.graph({ entity: "product", fields: ["variants.id", "variants.inventory_items.inventory_item_id"], filters: { id: product.id } });
      const inventory = container.resolve<IInventoryService>(Modules.INVENTORY);
      await inventory.createInventoryLevels({ inventory_item_id: stored.variants[0].inventory_items[0].inventory_item_id, location_id: location.id, stocked_quantity: 2 });
      const { result: [shipping] } = await createShippingOptionsWorkflow(container).run({ input: [{
        name: "Доставка для возврата", price_type: "flat", provider_id: "manual_manual", service_zone_id: set.service_zones[0].id,
        shipping_profile_id: profile.id, type: { label: "СДЭК ПВЗ", description: "Offline fixture", code: "cdek-pvz" },
        prices: [{ currency_code: "rub", amount: 100 }], rules: [
          { attribute: "enabled_in_store", value: "true", operator: "eq" }, { attribute: "is_return", value: "false", operator: "eq" },
        ],
      }] });
      const publicHeaders = { "x-publishable-api-key": key.token };
      const cart = await api.post("/store/carts", { region_id: region.id }, { headers: publicHeaders });
      const cartId = cart.data.cart.id;
      const headers = { ...publicHeaders, "x-cart-access-token": cart.data.cart_access_token };
      await api.post(`/store/carts/${cartId}/line-items`, { variant_id: stored.variants[0].id, quantity: 1 }, { headers });
      await api.post(`/store/carts/${cartId}`, {
        email: "refund@example.test", metadata: { delivery_type: "cdek-pvz" },
        shipping_address: { first_name: "Тест", address_1: "Тестовая, 1", city: "Москва", country_code: "ru", postal_code: "101000", phone: "+79991234567" },
      }, { headers });
      const shipped = await api.post(`/store/carts/${cartId}/shipping-methods`, { option_id: shipping.id }, { headers });
      const total = Math.round(Number(shipped.data.cart.total) * 100);
      const collection = await api.post("/store/payment-collections", { cart_id: cartId }, { headers });
      const initiated = await api.post(`/store/payment-collections/${collection.data.payment_collection.id}/payment-sessions`, {
        provider_id: "pp_tbank_tbank", data: { expected_total: total / 100 },
      }, { headers });
      const session = initiated.data.payment_collection.payment_sessions.find((item: { provider_id: string }) => item.provider_id === "pp_tbank_tbank");
      const state = [...states.values()].find((item) => item.orderId === session.id)!;
      state.status = "CONFIRMED";
      const paid = { TerminalKey: "TinkoffBankTest", PaymentId: state.id, OrderId: session.id, Status: "CONFIRMED", Amount: total, Success: true, ErrorCode: "0" };
      await api.post("/hooks/payment/tbank", { ...paid, Token: generateToken(paid, "TinkoffBankTest") });
      let paymentId = ""; let orderId = "";
      for (let attempt = 0; attempt < 80; attempt++) {
        const { data: payments } = await query.graph({ entity: "payment", fields: ["id", "captured_at"], filters: { payment_session_id: session.id } });
        const { data: orders } = await query.graph({ entity: "order_cart", fields: ["order_id"], filters: { cart_id: cartId } });
        if (payments[0]?.captured_at && orders[0]?.order_id) { paymentId = payments[0].id; orderId = orders[0].order_id; break; }
        await delay(100);
      }
      if (!paymentId || !orderId) throw new Error("Offline checkout did not produce a captured order");
      const config = container.resolve<ConfigModule>(ContainerRegistrationKeys.CONFIG_MODULE);
      const users = container.resolve<IUserModuleService>(Modules.USER);
      const admin = await users.createUsers({ email: "refund-operator@example.test" });
      const token = generateJwtToken({ actor_id: admin.id, actor_type: "user", auth_identity_id: "offline-refund-admin" }, { secret: config.projectConfig.http.jwtSecret, expiresIn: "5m" });
      const adminHeaders = { authorization: `Bearer ${token}` };
      const preview = async (): Promise<RefundPreview> => (await api.get(`/admin/payments/${paymentId}/tbank-refunds`, { headers: adminHeaders })).data.refund;
      const waitForPreview = async (predicate: (value: RefundPreview) => boolean): Promise<RefundPreview> => {
        for (let attempt = 0; attempt < 80; attempt++) { const value = await preview(); if (predicate(value)) return value; await delay(100); }
        throw new Error("Durable fiscal state did not reach the expected observable result");
      };
      const fiscal = async (type: string, amount: number, document = ++fiscalSequence) => {
        const payload = { TerminalKey: "TinkoffBankTest", PaymentId: state.id, OrderId: session.id, Status: "RECEIPT",
          Success: true, ErrorCode: "0", Amount: amount, Type: type, FiscalNumber: document, ShiftNumber: 1,
          ReceiptDatetime: "2026-11-16T12:00:00+03:00", FnNumber: "9999078900001234", EcrRegNumber: "0000000000010001",
          FiscalDocumentNumber: document, FiscalDocumentAttribute: document + 5000 };
        const response = await api.post("/hooks/payment/tbank", { ...payload, Token: generateToken(payload, "TinkoffBankTest") });
        expect(response.data).toBe("OK");
        return payload;
      };
      await fiscal("offline-income", total);
      await waitForPreview((value) => value.closing_available);
      return { query, inventory, paymentId, orderId, state, total, locationId: location.id, shippingId: shipping.id, headers: adminHeaders, preview, waitForPreview, fiscal };
    }

    it("refunds the full original payment once across concurrent, native and changed-key retries", async () => {
      const f = await fixture();
      const initial = await f.preview();
      const body = { idempotency_key: "full-original", receipt_mode: "prepayment", items: initial.lines.map((line) => ({ line_index: line.line_index, quantity: line.available_quantity })) };
      const unauthorized = await api.post(`/admin/payments/${f.paymentId}/tbank-refunds`, body, { validateStatus: () => true });
      expect(unauthorized.status).toBe(401);
      const reservationsBefore = await f.inventory.listReservationItems({ line_item_id: (await f.query.graph({ entity: "order", fields: ["items.id"], filters: { id: f.orderId } })).data[0].items[0].id });
      const [first, concurrent] = await Promise.all([1, 2].map(() => api.post(`/admin/payments/${f.paymentId}/tbank-refunds`, body, { headers: f.headers })));
      expect(first.data.refund.operation.native_refund_id).toBe(concurrent.data.refund.operation.native_refund_id);
      expect(f.state.balance).toBe(0);
      expect(calls.filter((call) => call.method === "Cancel")).toHaveLength(1);
      expect(calls.find((call) => call.method === "Cancel")!.body.Receipt).toBeUndefined();
      const wrong = await api.post(`/admin/payments/${f.paymentId}/tbank-refunds`, { ...body, items: [body.items[0]] }, { headers: f.headers, validateStatus: () => true });
      expect(wrong.status).toBe(400);
      await f.fiscal("offline-return", f.total);
      const done = await f.waitForPreview((value) => value.operations[0]?.fiscal_state === "succeeded");
      const nativeReplay = await api.post(`/admin/payments/${f.paymentId}/refund`, { amount: f.total / 100, idempotency_key: body.idempotency_key }, { headers: f.headers });
      expect(nativeReplay.status).toBe(200);
      expect(calls.filter((call) => call.method === "Cancel")).toHaveLength(1);
      const { data: [order] } = await f.query.graph({ entity: "order", fields: ["summary", "credit_lines.*", "transactions.*", "items.id"], filters: { id: f.orderId } });
      expect(Number(order.summary.pending_difference)).toBe(0);
      expect(order.credit_lines.filter((line: { reference_id: string }) => line.reference_id === done.operations[0].id).map((line: { amount: number }) => Number(line.amount))).toEqual([f.total / 100]);
      expect(order.transactions.filter((transaction: { reference: string }) => transaction.reference === "refund").map((transaction: { amount: number }) => Number(transaction.amount))).toEqual([-f.total / 100]);
      const reservationsAfter = await f.inventory.listReservationItems({ line_item_id: order.items[0].id });
      expect(reservationsAfter.map((item) => [item.inventory_item_id, item.location_id, Number(item.quantity)])).toEqual(reservationsBefore.map((item) => [item.inventory_item_id, item.location_id, Number(item.quantity)]));
    });

    it("closes prepaid goods without new electronic money and refunds exact marked rows at the full-payment stage", async () => {
      process.env.TBANK_API_BASE_URL = "https://securepay.tinkoff.ru/v2";
      const f = await fixture();
      const initial = await f.preview();
      expect(initial.closing_available).toBe(true);
      const closeItems = initial.lines.map((line) => ({ line_index: line.line_index, quantity: line.available_quantity,
        ...(line.payment_object === "commodity" ? { mark_codes: [mark] } : {}) }));
      const closingBody = { idempotency_key: "handover", items: closeItems };
      await api.post(`/admin/payments/${f.paymentId}/tbank-closing-receipt`, closingBody, { headers: f.headers });
      await api.post(`/admin/payments/${f.paymentId}/tbank-closing-receipt`, closingBody, { headers: f.headers });
      const closingCalls = calls.filter((call) => call.method === "SendClosingReceipt");
      expect(closingCalls).toHaveLength(1);
      expect(closingCalls[0].body.Receipt.Payments).toEqual({ Electronic: 0, AdvancePayment: f.total });
      expect(closingCalls[0].body.Receipt.Items.find((item: { MarkCode?: unknown }) => item.MarkCode).MarkCode.Value).toBe(mark);
      await f.fiscal("offline-income", f.total);
      await f.waitForPreview((value) => value.receipt_mode === "full_payment");
      const service = initial.lines.find((line) => line.payment_object === "service")!;
      const partial = await api.post(`/admin/payments/${f.paymentId}/tbank-refunds`, {
        idempotency_key: "shipping-refund", receipt_mode: "full_payment", items: [{ line_index: service.line_index, quantity: 1 }],
      }, { headers: f.headers });
      expect(partial.data.refund.operation.state).toBe("succeeded");
      const blocked = await api.post(`/admin/payments/${f.paymentId}/refund`, {}, { headers: f.headers, validateStatus: () => true });
      expect(blocked.status).toBe(409);
      await f.fiscal("offline-return", service.price_kopecks);
      await f.waitForPreview((value) => value.operations.find((operation) => operation.idempotency_key === "shipping-refund")?.fiscal_state === "succeeded");
      await api.post(`/admin/payments/${f.paymentId}/refund`, {}, { headers: f.headers });
      const refunds = calls.filter((call) => call.method === "Cancel");
      expect(refunds.map((call) => call.body.Amount)).toEqual([service.price_kopecks, f.total - service.price_kopecks]);
      expect(refunds[1].body.Receipt.Items[0]).toEqual(expect.objectContaining({ Tax: "vat5", PaymentMethod: "full_payment", MarkCode: { MarkCodeType: "RAWCODE", Value: mark } }));
      expect(f.state.balance).toBe(0);
    });

    it("recovers a lost full-refund response with the same bank identifier and one native refund", async () => {
      const f = await fixture();
      const initial = await f.preview();
      const body = { idempotency_key: "lost-full-response", receipt_mode: "prepayment", items: initial.lines.map((line) => ({ line_index: line.line_index, quantity: line.available_quantity })) };
      fault = "timeout-after";
      const uncertain = await api.post(`/admin/payments/${f.paymentId}/tbank-refunds`, body, { headers: f.headers });
      expect(uncertain.data.refund.operation.state).toBe("indeterminate");
      expect(f.state.balance).toBe(0);
      const recovered = await api.post(`/admin/payments/${f.paymentId}/tbank-refunds`, body, { headers: f.headers });
      expect(recovered.data.refund.operation.state).toBe("succeeded");
      const refunds = calls.filter((call) => call.method === "Cancel");
      expect(refunds).toHaveLength(2);
      expect(refunds[1].body.ExternalRequestId).toBe(refunds[0].body.ExternalRequestId);
      expect(f.state.refunds.size).toBe(1);
      const { data: [payment] } = await f.query.graph({ entity: "payment", fields: ["refunds.id", "refunds.amount"], filters: { id: f.paymentId } });
      expect(payment.refunds.map((item: { amount: number }) => Number(item.amount))).toEqual([f.total / 100]);
    });

    it("does not retry an ambiguous small partial refund or release its quantity", async () => {
      const f = await fixture();
      const initial = await f.preview();
      const service = initial.lines.find((line) => line.payment_object === "service")!;
      const body = { idempotency_key: "ambiguous-partial", receipt_mode: "prepayment", items: [{ line_index: service.line_index, quantity: 1 }] };
      fault = "timeout-after";
      await api.post(`/admin/payments/${f.paymentId}/tbank-refunds`, body, { headers: f.headers });
      const retry = await api.post(`/admin/payments/${f.paymentId}/tbank-refunds`, body, { headers: f.headers, validateStatus: () => true });
      expect([202, 409]).toContain(retry.status);
      expect(calls.filter((call) => call.method === "Cancel")).toHaveLength(1);
      expect(f.state.balance).toBe(f.total - service.price_kopecks);
      expect((await f.preview()).lines[service.line_index].available_quantity).toBe(0);
      const otherKey = await api.post(`/admin/payments/${f.paymentId}/tbank-refunds`, { ...body, idempotency_key: "unsafe-new-key" }, { headers: f.headers, validateStatus: () => true });
      const { data: [order] } = await f.query.graph({ entity: "order", fields: ["items.id"], filters: { id: f.orderId } });
      const shipment = await api.post(`/admin/orders/${f.orderId}/fulfillments`, {
        items: [{ id: order.items[0].id, quantity: 1 }], location_id: f.locationId, shipping_option_id: f.shippingId, no_notification: true,
      }, { headers: f.headers, validateStatus: () => true });
      expect(shipment.status).toBe(409);
      expect(otherKey.status).toBe(409);
    });

    it("leaves order accounting unchanged after a definite bank rejection", async () => {
      const f = await fixture();
      const initial = await f.preview();
      fault = "reject";
      const response = await api.post(`/admin/payments/${f.paymentId}/tbank-refunds`, {
        idempotency_key: "rejected", receipt_mode: "prepayment", items: initial.lines.map((line) => ({ line_index: line.line_index, quantity: line.available_quantity })),
      }, { headers: f.headers });
      expect((response.data.refund as RefundResult).operation.state).toBe("rejected");
      expect(f.state.balance).toBe(f.total);
      const { data: [order] } = await f.query.graph({ entity: "order", fields: ["summary", "credit_lines.*", "transactions.*"], filters: { id: f.orderId } });
      expect(Number(order.summary.pending_difference)).toBe(0);
      expect(order.credit_lines).toEqual([]);
      expect(order.transactions.filter((transaction: { reference: string }) => transaction.reference === "refund")).toEqual([]);
      expect((await f.preview()).refundable_amount_kopecks).toBe(f.total);
    });
  } });
});
