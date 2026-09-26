import { z } from "zod";

import { YANDEX_DELIVERY_PROVIDER_IDENTIFIER } from "./provider-id";

const YANDEX_ENABLED_SCHEMA = z.enum(["true", "false"]).optional();

export const YANDEX_PLATFORM_API_BASE_URL = "https://b2b-authproxy.taxi.yandex.net/api/b2b/platform";
export const YANDEX_PLATFORM_TST_API_BASE_URL = "https://b2b.taxi.tst.yandex.net/api/b2b/platform";

const YANDEX_ENVIRONMENT_SCHEMA = z.object({
  YANDEX_DELIVERY_TOKEN: z.string().trim().min(1),
  YANDEX_DELIVERY_API_BASE_URL: z
    .string()
    .trim()
    .optional()
    .transform((value) => {
      if (!value) return YANDEX_PLATFORM_API_BASE_URL;
      return value.replace(/\/$/u, "");
    })
    .refine((v) => /^https?:\/\/.+/u.test(v), {
      message: "YANDEX_DELIVERY_API_BASE_URL must be a valid URL",
    }),
  YANDEX_DELIVERY_SOURCE_STATION_ID: z.string().trim().min(1).max(200),
});

export type YandexDeliveryProviderOptions = {
  readonly token: string;
  readonly apiBaseUrl: string;
  readonly sourceStationId: string;
};

export type YandexDeliveryConfiguration =
  | { readonly enabled: false }
  | {
      readonly enabled: true;
      readonly providerIdentifier: typeof YANDEX_DELIVERY_PROVIDER_IDENTIFIER;
      readonly options: YandexDeliveryProviderOptions;
    };

export class YandexDeliveryConfigurationError extends Error {
  readonly name = "YandexDeliveryConfigurationError";

  constructor(readonly variables: readonly string[]) {
    super(`Invalid Yandex Delivery configuration: ${variables.join(", ")}`);
  }
}

export function parseYandexDeliveryEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
): YandexDeliveryConfiguration {
  const enabledResult = YANDEX_ENABLED_SCHEMA.safeParse(environment.YANDEX_DELIVERY_ENABLED);
  if (!enabledResult.success) {
    throw new YandexDeliveryConfigurationError(["YANDEX_DELIVERY_ENABLED"]);
  }

  if (enabledResult.data !== "true") return { enabled: false };

  const result = YANDEX_ENVIRONMENT_SCHEMA.safeParse(environment);
  if (!result.success) {
    const variables = [
      ...new Set(
        result.error.issues.map((issue) => String(issue.path[0] ?? "YANDEX_DELIVERY_*")),
      ),
    ];
    throw new YandexDeliveryConfigurationError(variables);
  }

  return {
    enabled: true,
    providerIdentifier: YANDEX_DELIVERY_PROVIDER_IDENTIFIER,
    options: {
      token: result.data.YANDEX_DELIVERY_TOKEN,
      apiBaseUrl: result.data.YANDEX_DELIVERY_API_BASE_URL,
      sourceStationId: result.data.YANDEX_DELIVERY_SOURCE_STATION_ID,
    },
  };
}
