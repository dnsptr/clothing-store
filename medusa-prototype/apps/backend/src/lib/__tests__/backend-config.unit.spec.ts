import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";

import { resolveTbankPaymentModules } from "../../modules/tbank/config";

const VALID_ENABLED_ENVIRONMENT = {
  TBANK_ENABLED: "true",
  TBANK_PAYMENT_PROVIDER_ID: "pp_tbank_tbank",
  TBANK_TERMINAL_KEY: "TinkoffBankTest",
  TBANK_PASSWORD: "fixture-password",
  TBANK_API_BASE_URL: "https://securepay.tinkoff.ru/v2",
  TBANK_SUCCESS_URL: "https://www.mariomikke.shop/checkout/success",
  TBANK_FAIL_URL: "https://www.mariomikke.shop/checkout/fail",
  TBANK_NOTIFICATION_URL: "https://api.mariomikke.shop/hooks/payment/tbank",
} as const;

describe("backend payment configuration", () => {
  it("omits the T-Bank payment module when disabled", () => {
    const modules = resolveTbankPaymentModules({ TBANK_ENABLED: "false" });

    expect(modules).toEqual([]);
  });

  it("registers the canonical T-Bank provider with parsed options when enabled", () => {
    const modules = resolveTbankPaymentModules(VALID_ENABLED_ENVIRONMENT);

    expect(modules).toEqual([
      {
        resolve: "@medusajs/medusa/payment",
        options: {
          providers: [
            {
              resolve: "./src/modules/tbank",
              id: "tbank",
              options: {
                terminalKey: "TinkoffBankTest",
                password: "fixture-password",
                apiBaseUrl: "https://securepay.tinkoff.ru/v2",
                successUrl: "https://www.mariomikke.shop/checkout/success",
                failUrl: "https://www.mariomikke.shop/checkout/fail",
                notificationUrl: "https://api.mariomikke.shop/hooks/payment/tbank",
              },
            },
          ],
        },
      },
    ]);
  });

  it("propagates exactly eight T-Bank variables through rendered Compose config", () => {
    const composeFile = resolve(__dirname, "../../../../../compose.production.yml");
    const environmentFile = resolve(__dirname, "../../../../../.env.production.payment-fixture");
    const testEnv = Object.fromEntries(
      Object.entries(process.env).filter(([k]) => !k.startsWith("TBANK_")),
    );
    const rendered = spawnSync(
      "docker",
      ["compose", "--env-file", environmentFile, "-f", composeFile, "config", "--format", "json"],
      { encoding: "utf8", timeout: 30_000, env: testEnv },
    );

    if (rendered.status !== 0) {
      throw new Error("Client-only Docker Compose config validation failed");
    }

    const parsed = z.object({
      services: z.object({
        medusa: z.object({ environment: z.record(z.string(), z.string()) }),
      }),
    }).parse(JSON.parse(rendered.stdout));
    const tbankEnvironment = Object.fromEntries(
      Object.entries(parsed.services.medusa.environment)
        .filter(([name]) => name.startsWith("TBANK_"))
        .sort(([left], [right]) => left.localeCompare(right)),
    );

    expect(tbankEnvironment).toEqual({
      TBANK_API_BASE_URL: "https://securepay.tinkoff.ru/v2",
      TBANK_ENABLED: "true",
      TBANK_FAIL_URL: "https://www.mariomikke.shop/checkout/fail",
      TBANK_NOTIFICATION_URL: "https://api.mariomikke.shop/hooks/payment/tbank",
      TBANK_PASSWORD: "fixture-password",
      TBANK_PAYMENT_PROVIDER_ID: "pp_tbank_tbank",
      TBANK_SUCCESS_URL: "https://www.mariomikke.shop/checkout/success",
      TBANK_TERMINAL_KEY: "fixture-terminal",
    });
  });

  it("keeps backend callback examples inside the parser allow-list", () => {
    const template = readFileSync(resolve(__dirname, "../../../.env.template"), "utf8");

    expect(template).toContain(
      "TBANK_SUCCESS_URL=https://www.mariomikke.shop/checkout/success",
    );
    expect(template).toContain(
      "TBANK_FAIL_URL=https://www.mariomikke.shop/checkout/fail",
    );
    expect(template).toContain(
      "TBANK_NOTIFICATION_URL=https://api.mariomikke.shop/hooks/payment/tbank",
    );
    expect(template).not.toContain("TBANK_SUCCESS_URL=http://localhost");
    expect(template).not.toContain("TBANK_FAIL_URL=http://localhost");
  });
});
