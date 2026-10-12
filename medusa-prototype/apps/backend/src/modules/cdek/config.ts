import { z } from "zod";

import { CDEK_PROVIDER_IDENTIFIER } from "./provider-id";

const CDEK_ENABLED_SCHEMA = z.enum(["true", "false"]).optional();

const CDEK_REQUIRED_VARIABLES = [
  "CDEK_CLIENT_ID",
  "CDEK_CLIENT_SECRET",
  "CDEK_API_BASE_URL",
] as const;

const CDEK_ENVIRONMENT_SCHEMA = z.object({
  CDEK_CLIENT_ID: z.string().trim().min(1),
  CDEK_CLIENT_SECRET: z.string().trim().min(1),
  CDEK_API_BASE_URL: z.enum([
    "https://api.cdek.ru/v2",
    "https://api.edu.cdek.ru/v2",
    "https://api.cdek.ru/v2/",
    "https://api.edu.cdek.ru/v2/",
  ]),
  CDEK_FROM_CITY_CODE: z
    .string()
    .trim()
    .regex(/^[1-9]\d*$/, "CDEK_FROM_CITY_CODE must be a positive integer")
    .transform(Number)
    .refine(Number.isSafeInteger, {
      message: "CDEK_FROM_CITY_CODE must be a safe integer",
    }),
});

export type CdekProviderOptions = {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly apiBaseUrl: string;
  readonly fromCityCode: number;
};

export type CdekConfiguration =
  | { readonly enabled: false }
  | {
      readonly enabled: true;
      readonly providerIdentifier: typeof CDEK_PROVIDER_IDENTIFIER;
      readonly options: CdekProviderOptions;
    };

export class CdekConfigurationError extends Error {
  readonly name = "CdekConfigurationError";

  constructor(readonly variables: readonly string[]) {
    super(`Invalid CDEK configuration: ${variables.join(", ")}`);
  }
}

export function parseCdekEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
): CdekConfiguration {
  const enabledResult = CDEK_ENABLED_SCHEMA.safeParse(environment.CDEK_ENABLED);
  if (!enabledResult.success) {
    throw new CdekConfigurationError(["CDEK_ENABLED"]);
  }

  // If CDEK_ENABLED is not explicitly "true", check if any credentials are provided
  if (enabledResult.data !== "true") {
    const configuredVariables = CDEK_REQUIRED_VARIABLES.filter(
      (name) => environment[name]?.trim(),
    );
    // If credentials are partially provided without CDEK_ENABLED=true, warn or disable
    if (configuredVariables.length > 0 && configuredVariables.length < CDEK_REQUIRED_VARIABLES.length) {
      throw new CdekConfigurationError(configuredVariables);
    }
    // If CDEK is not enabled, return disabled configuration
    return { enabled: false };
  }

  const result = CDEK_ENVIRONMENT_SCHEMA.safeParse(environment);
  if (!result.success) {
    const variables = [
      ...new Set(
        result.error.issues.map((issue) => String(issue.path[0] ?? "CDEK_*")),
      ),
    ];
    throw new CdekConfigurationError(variables);
  }

  return {
    enabled: true,
    providerIdentifier: CDEK_PROVIDER_IDENTIFIER,
    options: {
      clientId: result.data.CDEK_CLIENT_ID,
      clientSecret: result.data.CDEK_CLIENT_SECRET,
      apiBaseUrl: result.data.CDEK_API_BASE_URL.replace(/\/$/, ""),
      fromCityCode: result.data.CDEK_FROM_CITY_CODE,
    },
  };
}
