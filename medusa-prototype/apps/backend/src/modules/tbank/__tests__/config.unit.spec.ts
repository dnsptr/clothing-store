import { parseTbankEnvironment, TBankConfigurationError } from "../config";

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

describe("parseTbankEnvironment", () => {
  it("disables the provider when TBANK_ENABLED is false, even with stale values", () => {
    const environment = {
      ...VALID_ENABLED_ENVIRONMENT,
      TBANK_ENABLED: "false",
      TBANK_PASSWORD: "stale-password",
    };

    const result = parseTbankEnvironment(environment);

    expect(result).toEqual({ enabled: false });
  });

  it("defaults to disabled when TBANK_ENABLED is absent", () => {
    const result = parseTbankEnvironment({});

    expect(result).toEqual({ enabled: false });
  });

  it.each(["TRUE", "1", "enabled", " false "])(
    "rejects malformed TBANK_ENABLED=%s",
    (enabled) => {
      expect(() => parseTbankEnvironment({ TBANK_ENABLED: enabled })).toThrow(
        TBankConfigurationError,
      );
    },
  );

  it.each([
    "TBANK_PAYMENT_PROVIDER_ID",
    "TBANK_TERMINAL_KEY",
    "TBANK_PASSWORD",
    "TBANK_API_BASE_URL",
    "TBANK_SUCCESS_URL",
    "TBANK_FAIL_URL",
    "TBANK_NOTIFICATION_URL",
  ] as const)("rejects enabled configuration missing %s", (missingName) => {
    const environment = { ...VALID_ENABLED_ENVIRONMENT };
    delete environment[missingName];

    expect(() => parseTbankEnvironment(environment)).toThrow(TBankConfigurationError);
  });

  it("rejects a payment provider other than pp_tbank_tbank", () => {
    const environment = {
      ...VALID_ENABLED_ENVIRONMENT,
      TBANK_PAYMENT_PROVIDER_ID: "pp_system_default",
    };

    expect(() => parseTbankEnvironment(environment)).toThrow(TBankConfigurationError);
  });

  it.each([
    ["localhost storefront", "TBANK_SUCCESS_URL", "https://localhost/checkout/success"],
    ["HTTP storefront", "TBANK_FAIL_URL", "http://www.mariomikke.shop/checkout/fail"],
    ["unapproved storefront", "TBANK_SUCCESS_URL", "https://attacker.example/checkout/success"],
    ["wrong success path", "TBANK_SUCCESS_URL", "https://www.mariomikke.shop/checkout/complete"],
    ["wrong fail path", "TBANK_FAIL_URL", "https://www.mariomikke.shop/checkout/success"],
    ["localhost callback", "TBANK_NOTIFICATION_URL", "https://localhost/hooks/payment/tbank"],
    ["unapproved callback", "TBANK_NOTIFICATION_URL", "https://attacker.example/hooks/payment/tbank"],
    ["wrong callback path", "TBANK_NOTIFICATION_URL", "https://api.mariomikke.shop/hooks/payment/tbank/extra"],
  ] as const)("rejects %s", (_caseName, variableName, value) => {
    const environment = { ...VALID_ENABLED_ENVIRONMENT, [variableName]: value };

    expect(() => parseTbankEnvironment(environment)).toThrow(TBankConfigurationError);
  });

  it.each([
    "http://securepay.tinkoff.ru/v2",
    "https://localhost/v2",
    "https://securepay.tinkoff.ru/v3",
    "https://attacker.example/v2",
  ])("rejects unsafe or unapproved API base URL %s", (apiBaseUrl) => {
    const environment = {
      ...VALID_ENABLED_ENVIRONMENT,
      TBANK_API_BASE_URL: apiBaseUrl,
    };

    expect(() => parseTbankEnvironment(environment)).toThrow(TBankConfigurationError);
  });

  it.each([
    "https://securepay.tinkoff.ru/v2",
    "https://rest-api-test.tinkoff.ru/v2",
  ])("accepts a complete enabled row for %s", (apiBaseUrl) => {
    const environment = {
      ...VALID_ENABLED_ENVIRONMENT,
      TBANK_API_BASE_URL: apiBaseUrl,
    };

    const result = parseTbankEnvironment(environment);

    expect(result).toEqual({
      enabled: true,
      paymentProviderId: "pp_tbank_tbank",
      options: {
        terminalKey: "TinkoffBankTest",
        password: "fixture-password",
        apiBaseUrl,
        successUrl: "https://www.mariomikke.shop/checkout/success",
        failUrl: "https://www.mariomikke.shop/checkout/fail",
        notificationUrl: "https://api.mariomikke.shop/hooks/payment/tbank",
      },
    });
  });

  it("does not include credential values in validation errors", () => {
    const secret = "must-not-appear-in-errors";
    const environment = {
      ...VALID_ENABLED_ENVIRONMENT,
      TBANK_PASSWORD: secret,
      TBANK_SUCCESS_URL: "malformed",
    };

    let message = "";
    try {
      parseTbankEnvironment(environment);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).not.toContain(secret);
  });
});
