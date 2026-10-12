import {
  parseYandexDeliveryEnvironment,
  YandexDeliveryConfigurationError,
  YANDEX_PLATFORM_API_BASE_URL,
} from "../config";
import { YANDEX_DELIVERY_PROVIDER_IDENTIFIER } from "../provider-id";

const VALID_YANDEX_ENVIRONMENT = {
  YANDEX_DELIVERY_ENABLED: "true",
  YANDEX_DELIVERY_TOKEN: "yandex_oauth_test_token",
  YANDEX_DELIVERY_API_BASE_URL: "https://b2b-authproxy.taxi.yandex.net/api/b2b/platform",
  YANDEX_DELIVERY_SOURCE_STATION_ID: "station_mario_mikke_test",
} as const;

describe("parseYandexDeliveryEnvironment", () => {
  it("disables Yandex Delivery when YANDEX_DELIVERY_ENABLED is false", () => {
    expect(parseYandexDeliveryEnvironment({ YANDEX_DELIVERY_ENABLED: "false" })).toEqual({
      enabled: false,
    });
  });

  it("defaults to disabled when YANDEX_DELIVERY_ENABLED is absent", () => {
    expect(parseYandexDeliveryEnvironment({})).toEqual({ enabled: false });
  });

  it("parses valid enabled configuration correctly", () => {
    const config = parseYandexDeliveryEnvironment(VALID_YANDEX_ENVIRONMENT);
    expect(config).toEqual({
      enabled: true,
      providerIdentifier: YANDEX_DELIVERY_PROVIDER_IDENTIFIER,
      options: {
        token: "yandex_oauth_test_token",
        apiBaseUrl: "https://b2b-authproxy.taxi.yandex.net/api/b2b/platform",
        sourceStationId: "station_mario_mikke_test",
      },
    });
  });

  it.each(["", "  "])("rejects a missing or unconfirmed origin station ID (%s)", (sourceStationId) => {
    expect(() => parseYandexDeliveryEnvironment({
      ...VALID_YANDEX_ENVIRONMENT,
      YANDEX_DELIVERY_SOURCE_STATION_ID: sourceStationId,
    })).toThrow(YandexDeliveryConfigurationError);
  });

  it("uses the official production API by default", () => {
    const config = parseYandexDeliveryEnvironment({
      ...VALID_YANDEX_ENVIRONMENT,
      YANDEX_DELIVERY_API_BASE_URL: undefined,
    });
    expect(config.enabled && config.options.apiBaseUrl).toBe(YANDEX_PLATFORM_API_BASE_URL);
  });

  it("strips trailing slash from apiBaseUrl", () => {
    const config = parseYandexDeliveryEnvironment({
      ...VALID_YANDEX_ENVIRONMENT,
      YANDEX_DELIVERY_API_BASE_URL: "https://b2b-authproxy.taxi.yandex.net/api/b2b/platform/",
    });
    expect(config.enabled && config.options.apiBaseUrl).toBe(
      "https://b2b-authproxy.taxi.yandex.net/api/b2b/platform",
    );
  });

  it("throws YandexDeliveryConfigurationError when required token is missing", () => {
    expect(() =>
      parseYandexDeliveryEnvironment({
        YANDEX_DELIVERY_ENABLED: "true",
      }),
    ).toThrow(YandexDeliveryConfigurationError);
  });

  it("rejects an invalid opt-in flag", () => {
    expect(() => parseYandexDeliveryEnvironment({
      ...VALID_YANDEX_ENVIRONMENT,
      YANDEX_DELIVERY_ENABLED: "maybe",
    })).toThrow(YandexDeliveryConfigurationError);
  });
});
