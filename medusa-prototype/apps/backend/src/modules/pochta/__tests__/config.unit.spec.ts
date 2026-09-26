import {
  parsePochtaEnvironment,
  PochtaConfigurationError,
} from "../config";
import { POCHTA_PROVIDER_IDENTIFIER } from "../provider-id";

const VALID_POCHTA_ENVIRONMENT = {
  POCHTA_ENABLED: "true",
  POCHTA_ACCESS_TOKEN: "test_access_token",
  POCHTA_USER_KEY: "test_user_key",
  POCHTA_API_BASE_URL: "https://otpravka-api.pochta.ru/1.0",
  POCHTA_FROM_INDEX: "119571",
} as const;

describe("parsePochtaEnvironment", () => {
  it("disables Pochta when POCHTA_ENABLED is false", () => {
    expect(parsePochtaEnvironment({ POCHTA_ENABLED: "false" })).toEqual({
      enabled: false,
    });
  });

  it("defaults to disabled when POCHTA_ENABLED is absent", () => {
    expect(parsePochtaEnvironment({})).toEqual({ enabled: false });
  });

  it("parses valid enabled configuration correctly", () => {
    const config = parsePochtaEnvironment(VALID_POCHTA_ENVIRONMENT);
    expect(config).toEqual({
      enabled: true,
      providerIdentifier: POCHTA_PROVIDER_IDENTIFIER,
      options: {
        accessToken: "test_access_token",
        userKey: "test_user_key",
        apiBaseUrl: "https://otpravka-api.pochta.ru/1.0",
        fromIndex: "119571",
      },
    });
  });

  it("rejects an enabled provider without a confirmed shipping origin", () => {
    expect(() => parsePochtaEnvironment({
      POCHTA_ENABLED: "true",
      POCHTA_ACCESS_TOKEN: "test_token",
      POCHTA_USER_KEY: "test_key",
    })).toThrow(PochtaConfigurationError);
  });
  it.each([
    "https://evil.example/1.0",
    "http://otpravka-api.pochta.ru/1.0",
    "https://user:pass@otpravka-api.pochta.ru/1.0",
    "https://otpravka-api.pochta.ru/1.0?next=https://evil.example",
    "https://otpravka-api.pochta.ru/1.0#fragment",
    "https://otpravka-api.pochta.ru/1.0/../admin",
    "https://otpravka-api.pochta.ru/1.0/",
  ])("rejects non-canonical API base URL %s", (apiBaseUrl) => {
    expect(() => parsePochtaEnvironment({
      ...VALID_POCHTA_ENVIRONMENT,
      POCHTA_API_BASE_URL: apiBaseUrl,
    })).toThrow(PochtaConfigurationError);
  });

  it("throws PochtaConfigurationError when required token is missing", () => {
    expect(() =>
      parsePochtaEnvironment({
        POCHTA_ENABLED: "true",
        POCHTA_USER_KEY: "only_user_key",
      }),
    ).toThrow(PochtaConfigurationError);
  });

  it("rejects invalid postal code format", () => {
    expect(() =>
      parsePochtaEnvironment({
        ...VALID_POCHTA_ENVIRONMENT,
        POCHTA_FROM_INDEX: "123", // not 6 digits
      }),
    ).toThrow(PochtaConfigurationError);
  });
});
