import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isCheckoutEnabledForConfiguration } from "../payment-config";

const GATE_CASES = [
  ["missing provider", "", "production", false, false],
  ["arbitrary provider", "pp_other_provider", "production", false, false],
  ["system provider in production", "pp_system_default", "production", true, false],
  ["system provider in development without escape hatch", "pp_system_default", "development", false, false],
  ["system provider in development with escape hatch", "pp_system_default", "development", true, true],
  ["canonical T-Bank provider", "pp_tbank_tbank", "production", false, true],
] as const;

describe("storefront checkout provider gate", () => {
  for (const [caseName, providerId, nodeEnvironment, allowTestCheckout, expected] of GATE_CASES) {
    it(caseName, () => {
      const enabled = isCheckoutEnabledForConfiguration({
        providerId,
        nodeEnvironment,
        allowTestCheckout,
      });

      assert.equal(enabled, expected);
    });
  }
});
