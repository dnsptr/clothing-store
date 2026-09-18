import type { ICartModuleService } from "@medusajs/framework/types";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";
import {
  createPaymentCollectionForCartWorkflow,
  createPaymentSessionsWorkflow,
} from "@medusajs/medusa/core-flows";

import { TBankReceiptSource, type ReceiptQuery } from "../lib/receipt-source";

const DATABASE_URL = process.env.TBANK_INBOX_TEST_DATABASE_URL;

if (!DATABASE_URL) {
  describe.skip("TBankReceiptSource Medusa persistence", () => {
    it("requires TBANK_INBOX_TEST_DATABASE_URL", () => undefined);
  });
} else {
  const databaseUrl = new URL(DATABASE_URL);
  process.env.DB_HOST = databaseUrl.hostname === "127.0.0.1" ? "localhost" : databaseUrl.hostname;
  process.env.DB_PORT = databaseUrl.port || "5432";
  process.env.DB_USERNAME = decodeURIComponent(databaseUrl.username);
  process.env.DB_PASSWORD = decodeURIComponent(databaseUrl.password);

  const testUtils: typeof import("@medusajs/test-utils") = require("@medusajs/test-utils");

  jest.setTimeout(120_000);

  testUtils.medusaIntegrationTestRunner({
    env: { CDEK_ENABLED: "false", TBANK_ENABLED: "false" },
    testSuite: ({ getContainer }) => {
      describe("TBankReceiptSource Medusa persistence", () => {
        it("resolves a persisted payment session to discounted cart totals", async () => {
          // Given
          const container = getContainer();
          const cartService = container.resolve<ICartModuleService>(Modules.CART);
          const query = container.resolve<ReceiptQuery>(ContainerRegistrationKeys.QUERY);
          const cart = await cartService.createCarts({
            currency_code: "rub",
            email: "receipt@example.com",
            items: [
              {
                title: "Шерстяное пальто",
                variant_title: "Графит / M",
                quantity: 2,
                unit_price: 1_000,
                is_discountable: true,
                adjustments: [{ code: "AUTUMN", amount: 200 }],
              },
            ],
          });
          const { result: paymentCollection } = await createPaymentCollectionForCartWorkflow(
            container,
          ).run({ input: { cart_id: cart.id } });
          const { result: paymentSession } = await createPaymentSessionsWorkflow(container).run({
            input: {
              payment_collection_id: paymentCollection.id,
              provider_id: "pp_system_default",
            },
          });

          // When
          const resolution = await new TBankReceiptSource(query, "receipt-test-secret").resolve({
            sessionId: paymentSession.id,
            paymentAmountKopecks: 180_000,
          });

          // Then
          expect(resolution.cartId).toBe(cart.id);
          expect(resolution.receipt.Items).toEqual([
            expect.objectContaining({ Price: 90_000, Quantity: 2, Amount: 180_000 }),
          ]);
        });
      });
    },
  });
}
