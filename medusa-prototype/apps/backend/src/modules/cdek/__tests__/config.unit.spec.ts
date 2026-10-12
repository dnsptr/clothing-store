import { parseCdekEnvironment, CdekConfigurationError } from "../config";
import { CDEK_PROVIDER_IDENTIFIER } from "../provider-id";

const VALID_CDEK_ENVIRONMENT = {
  CDEK_ENABLED: "true",
  CDEK_CLIENT_ID: "test-client-id",
  CDEK_CLIENT_SECRET: "test-client-secret",
  CDEK_API_BASE_URL: "https://api.edu.cdek.ru/v2",
  CDEK_FROM_CITY_CODE: "44",
} as const;

describe("parseCdekEnvironment", () => {
  it("disables CDEK when CDEK_ENABLED is false", () => {
    expect(parseCdekEnvironment({ CDEK_ENABLED: "false" })).toEqual({ enabled: false });
  });

  it("defaults to disabled when CDEK_ENABLED is absent", () => {
    expect(parseCdekEnvironment({})).toEqual({ enabled: false });
  });

  it("parses valid enabled configuration correctly", () => {
    const config = parseCdekEnvironment(VALID_CDEK_ENVIRONMENT);
    expect(config).toEqual({
      enabled: true,
      providerIdentifier: CDEK_PROVIDER_IDENTIFIER,
      options: {
        clientId: "test-client-id",
        clientSecret: "test-client-secret",
        apiBaseUrl: "https://api.edu.cdek.ru/v2",
        fromCityCode: 44,
      },
    });
  });

  it("rejects an enabled provider without an explicitly configured origin city", () => {
    const { CDEK_FROM_CITY_CODE: _, ...withoutCity } = VALID_CDEK_ENVIRONMENT;
    expect(() => parseCdekEnvironment(withoutCity)).toThrow(CdekConfigurationError);
  });

  it("strips trailing slashes from apiBaseUrl", () => {
    const config = parseCdekEnvironment({
      ...VALID_CDEK_ENVIRONMENT,
      CDEK_API_BASE_URL: "https://api.edu.cdek.ru/v2/",
    });
    expect(config.enabled && config.options.apiBaseUrl).toBe("https://api.edu.cdek.ru/v2");
  });

  it("throws CdekConfigurationError when required variables are missing", () => {
    expect(() =>
      parseCdekEnvironment({ CDEK_ENABLED: "true", CDEK_CLIENT_ID: "only_id" }),
    ).toThrow(CdekConfigurationError);
  });

  it("rejects invalid non-integer fromCityCode", () => {
    expect(() =>
      parseCdekEnvironment({ ...VALID_CDEK_ENVIRONMENT, CDEK_FROM_CITY_CODE: "invalid" }),
    ).toThrow(CdekConfigurationError);
  });

  it("rejects a CDEK API URL outside the approved production and sandbox hosts", () => {
    expect(() => parseCdekEnvironment({
      ...VALID_CDEK_ENVIRONMENT,
      CDEK_API_BASE_URL: "https://attacker.example/v2",
    })).toThrow(CdekConfigurationError);
  });

  it.each([
    "http://api.cdek.ru/v2",
    "https://api.cdek.ru.evil.example/v2",
    "https://api.cdek.ru/v2?redirect=https://evil.example",
    "https://user:password@api.cdek.ru/v2",
    "https://api.cdek.ru/v2//",
  ])("rejects non-exact CDEK API origin %s", (apiBaseUrl) => {
    expect(() => parseCdekEnvironment({
      ...VALID_CDEK_ENVIRONMENT,
      CDEK_API_BASE_URL: apiBaseUrl,
    })).toThrow(CdekConfigurationError);
  });
});
