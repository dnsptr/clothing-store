import { z } from "zod";

import {
  TBANK_PAYMENT_PROVIDER_ID,
  TBANK_PROVIDER_CONFIG_ID,
} from "./provider-id";

const TBANK_ENABLED_SCHEMA = z.enum(["true", "false"]).optional();

const TBANK_PAYMENT_VARIABLES = [
  "TBANK_PAYMENT_PROVIDER_ID",
  "TBANK_TERMINAL_KEY",
  "TBANK_PASSWORD",
  "TBANK_API_BASE_URL",
  "TBANK_SUCCESS_URL",
  "TBANK_FAIL_URL",
  "TBANK_NOTIFICATION_URL",
] as const;

const TBANK_ENVIRONMENT_SCHEMA = z.object({
  TBANK_PAYMENT_PROVIDER_ID: z.literal(TBANK_PAYMENT_PROVIDER_ID),
  TBANK_TERMINAL_KEY: z.string().trim().min(1),
  TBANK_PASSWORD: z.string().min(1).refine((value) => value.trim().length > 0),
  TBANK_API_BASE_URL: z.enum([
    "https://securepay.tinkoff.ru/v2",
    "https://rest-api-test.tinkoff.ru/v2",
  ]),
  TBANK_SUCCESS_URL: z.enum([
    "https://mariomikke.shop/checkout/success",
    "https://www.mariomikke.shop/checkout/success",
  ]),
  TBANK_FAIL_URL: z.enum([
    "https://mariomikke.shop/checkout/fail",
    "https://www.mariomikke.shop/checkout/fail",
  ]),
  TBANK_NOTIFICATION_URL: z.literal(
    "https://api.mariomikke.shop/hooks/payment/tbank",
  ),
});

type TBankEnvironment = Readonly<Record<string, string | undefined>>;

type TBankProviderOptions = {
  readonly terminalKey: string;
  readonly password: string;
  readonly apiBaseUrl: string;
  readonly successUrl: string;
  readonly failUrl: string;
  readonly notificationUrl: string;
};

export type TBankConfiguration =
  | { readonly enabled: false }
  | {
      readonly enabled: true;
      readonly paymentProviderId: typeof TBANK_PAYMENT_PROVIDER_ID;
      readonly options: TBankProviderOptions;
    };

type TBankPaymentModule = {
  readonly resolve: "@medusajs/medusa/payment";
  readonly options: {
    readonly providers: readonly [{
      readonly resolve: "./src/modules/tbank";
      readonly id: typeof TBANK_PROVIDER_CONFIG_ID;
      readonly options: TBankProviderOptions;
    }];
  };
};

export class TBankConfigurationError extends Error {
  readonly name = "TBankConfigurationError";

  constructor(readonly variables: readonly string[]) {
    super(`Invalid T-Bank configuration: ${variables.join(", ")}`);
  }
}

export function parseTbankEnvironment(
  environment: TBankEnvironment,
): TBankConfiguration {
  const enabledResult = TBANK_ENABLED_SCHEMA.safeParse(environment.TBANK_ENABLED);
  if (!enabledResult.success) {
    throw new TBankConfigurationError(["TBANK_ENABLED"]);
  }

  if (enabledResult.data !== "true") {
    const configuredVariables = TBANK_PAYMENT_VARIABLES.filter(
      (name) => environment[name]?.trim(),
    );
    if (configuredVariables.length > 0) {
      throw new TBankConfigurationError(configuredVariables);
    }
    return { enabled: false };
  }

  const result = TBANK_ENVIRONMENT_SCHEMA.safeParse(environment);
  if (!result.success) {
    const variables = [
      ...new Set(
        result.error.issues.map((issue) => String(issue.path[0] ?? "TBANK_*")),
      ),
    ];
    throw new TBankConfigurationError(variables);
  }

  return {
    enabled: true,
    paymentProviderId: result.data.TBANK_PAYMENT_PROVIDER_ID,
    options: {
      terminalKey: result.data.TBANK_TERMINAL_KEY,
      password: result.data.TBANK_PASSWORD,
      apiBaseUrl: result.data.TBANK_API_BASE_URL,
      successUrl: result.data.TBANK_SUCCESS_URL,
      failUrl: result.data.TBANK_FAIL_URL,
      notificationUrl: result.data.TBANK_NOTIFICATION_URL,
    },
  };
}

export function resolveTbankPaymentModules(
  environment: TBankEnvironment,
): readonly TBankPaymentModule[] {
  const configuration = parseTbankEnvironment(environment);
  if (!configuration.enabled) {
    return [];
  }

  return [
    {
      resolve: "@medusajs/medusa/payment",
      options: {
        providers: [
          {
            resolve: "./src/modules/tbank",
            id: TBANK_PROVIDER_CONFIG_ID,
            options: configuration.options,
          },
        ],
      },
    },
  ];
}
