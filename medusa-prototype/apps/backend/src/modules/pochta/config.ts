import { z } from "zod";

import { POCHTA_PROVIDER_IDENTIFIER } from "./provider-id";

const POCHTA_ENABLED_SCHEMA = z.enum(["true", "false"]).optional();
export const POCHTA_API_BASE_URL = "https://otpravka-api.pochta.ru/1.0" as const;

const POCHTA_REQUIRED_VARIABLES = [
  "POCHTA_ACCESS_TOKEN",
  "POCHTA_USER_KEY",
] as const;

const POCHTA_ENVIRONMENT_SCHEMA = z.object({
  POCHTA_ACCESS_TOKEN: z.string().trim().min(1).max(2_048),
  POCHTA_USER_KEY: z.string().trim().min(1).max(2_048),
  POCHTA_API_BASE_URL: z.literal(POCHTA_API_BASE_URL).optional().default(POCHTA_API_BASE_URL),
  POCHTA_FROM_INDEX: z
    .string()
    .trim()
    .regex(/^\d{6}$/, "POCHTA_FROM_INDEX must be a 6-digit postal code"),
});

export type PochtaProviderOptions = {
  readonly accessToken: string;
  readonly userKey: string;
  readonly apiBaseUrl: string;
  readonly fromIndex: string;
};

export type PochtaConfiguration =
  | { readonly enabled: false }
  | {
      readonly enabled: true;
      readonly providerIdentifier: typeof POCHTA_PROVIDER_IDENTIFIER;
      readonly options: PochtaProviderOptions;
    };

export class PochtaConfigurationError extends Error {
  readonly name = "PochtaConfigurationError";

  constructor(readonly variables: readonly string[]) {
    super(`Invalid Russian Post configuration: ${variables.join(", ")}`);
  }
}

export function parsePochtaEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
): PochtaConfiguration {
  const enabledResult = POCHTA_ENABLED_SCHEMA.safeParse(environment.POCHTA_ENABLED);
  if (!enabledResult.success) {
    throw new PochtaConfigurationError(["POCHTA_ENABLED"]);
  }

  if (enabledResult.data !== "true") {
    const configuredVariables = POCHTA_REQUIRED_VARIABLES.filter(
      (name) => environment[name]?.trim(),
    );
    if (configuredVariables.length > 0 && configuredVariables.length < POCHTA_REQUIRED_VARIABLES.length) {
      throw new PochtaConfigurationError(configuredVariables);
    }
    return { enabled: false };
  }

  const result = POCHTA_ENVIRONMENT_SCHEMA.safeParse(environment);
  if (!result.success) {
    const variables = [
      ...new Set(
        result.error.issues.map((issue) => String(issue.path[0] ?? "POCHTA_*")),
      ),
    ];
    throw new PochtaConfigurationError(variables);
  }

  return {
    enabled: true,
    providerIdentifier: POCHTA_PROVIDER_IDENTIFIER,
    options: {
      accessToken: result.data.POCHTA_ACCESS_TOKEN,
      userKey: result.data.POCHTA_USER_KEY,
      apiBaseUrl: result.data.POCHTA_API_BASE_URL,
      fromIndex: result.data.POCHTA_FROM_INDEX,
    },
  };
}
