import { medusaIntegrationTestRunner } from "@medusajs/test-utils";

import { TBANK_NOTIFICATION_MODULE } from "../../src/modules/tbank-notifications";
import { generateToken } from "../../src/modules/tbank/lib/token";

jest.setTimeout(120000);

const PASSWORD = "offline-fiscal-test-password";
const FISCAL_BODY = {
  TerminalKey: "OfflineFiscalTerminal",
  PaymentId: 3456789,
  Status: "RECEIPT_FAILED",
  Type: "sell",
  Success: false,
  ErrorCode: "205",
  ErrorMessage: "Fiscal operator rejected the receipt",
  Amount: 1899000,
};

medusaIntegrationTestRunner({
  env: {
    TBANK_ENABLED: "true",
    TBANK_PAYMENT_PROVIDER_ID: "pp_tbank_tbank",
    TBANK_TERMINAL_KEY: FISCAL_BODY.TerminalKey,
    TBANK_PASSWORD: PASSWORD,
    TBANK_RECEIPT_SNAPSHOT_SECRET: "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=",
    TBANK_API_BASE_URL: "https://rest-api-test.tinkoff.ru/v2",
    TBANK_SUCCESS_URL: "https://mariomikke.shop/checkout/success",
    TBANK_FAIL_URL: "https://mariomikke.shop/checkout/fail",
    TBANK_NOTIFICATION_URL: "https://api.mariomikke.shop/hooks/payment/tbank",
  },
  testSuite: ({ api, getContainer }) => {
    it("persists a signed fiscal failure once across retries, rejects a forged token, and exposes no unauthenticated admin queue", async () => {
      const notifications = getContainer().resolve(TBANK_NOTIFICATION_MODULE) as {
        listTbankFiscalNotifications: (filters: Record<string, unknown>) => Promise<Array<{
          status: string;
          review_state: string;
          review_reason: string;
          error_code: string;
        }>>;
        listTbankNotifications: (filters: Record<string, unknown>) => Promise<unknown[]>;
      };
      const signed = { ...FISCAL_BODY, Token: generateToken(FISCAL_BODY, PASSWORD) };
      const forged = { ...signed, Token: "0".repeat(64) };

      const unauthorized = await api.post("/hooks/payment/tbank", forged, { validateStatus: () => true });
      expect(unauthorized.status).toBe(401);
      expect(await notifications.listTbankFiscalNotifications({})).toHaveLength(0);

      const first = await api.post("/hooks/payment/tbank", signed, { validateStatus: () => true });
      expect(first.status).toBe(200);
      expect(first.data).toBe("OK");
      const retry = await api.post("/hooks/payment/tbank", signed, { validateStatus: () => true });
      expect(retry.status).toBe(200);
      const rows = await notifications.listTbankFiscalNotifications({});
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        status: "RECEIPT_FAILED",
        review_state: "manual_review",
        error_code: "205",
      });
      expect(rows[0].review_reason).toContain("fiscal_error");
      expect(await notifications.listTbankNotifications({})).toHaveLength(0);

      const queue = await api.get("/admin/tbank/fiscal-notifications", { validateStatus: () => true });
      expect(queue.status).toBe(401);
    });
  },
});
