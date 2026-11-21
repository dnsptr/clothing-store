import checkoutHoldExpiry from "../checkout-hold-expiry";
import { CHECKOUT_HOLD_MODULE } from "../../modules/checkout-holds/contracts";
import { TBANK_NOTIFICATION_MODULE } from "../../modules/tbank-notifications";
import { TBankApiError, TBankClient } from "../../modules/tbank/lib/client";

jest.mock("../../modules/tbank/config", () => ({
  parseTbankEnvironment: () => ({ enabled: true, options: {
    terminalKey: "fixture-terminal", password: "fixture-password", apiBaseUrl: "http://127.0.0.1:9/v2",
  } }),
}));

function fixture(terminal = "fixture-terminal") {
  let state = "expired";
  const services: Record<string, unknown> = {
    [CHECKOUT_HOLD_MODULE]: {
      expirePaymentHolds: async () => {},
      claimExpiredPaymentHolds: async () => [{ id: "hold_1", payment_session_id: "session_1" }],
      releasePaymentHold: async (sessionId: string) => {
        if (sessionId !== "session_1") throw new Error("Unknown hold");
        state = "released";
      },
    },
    [TBANK_NOTIFICATION_MODULE]: {
      listTbankPaymentAttempts: async () => [{ terminal_key: terminal, provider_id: "pp_tbank_tbank" }],
    },
    logger: { warn: jest.fn() },
  };
  return { container: { resolve: (key: string) => services[key] } as never, state: () => state };
}

afterEach(() => jest.restoreAllMocks());

describe("expired checkout hold recovery", () => {
  it("releases a bank-confirmed absent order after a failed Init", async () => {
    jest.spyOn(TBankClient.prototype, "checkOrder").mockRejectedValue(new TBankApiError("CheckOrder", "407", "Not found"));
    const f = fixture();
    await checkoutHoldExpiry(f.container);
    expect(f.state()).toBe("released");
  });

  it.each(["NETWORK", "TIMEOUT", "401"])("does not turn bank error %s into available stock", async (code) => {
    jest.spyOn(TBankClient.prototype, "checkOrder").mockRejectedValue(new TBankApiError("CheckOrder", code, "Uncertain result"));
    const f = fixture();
    await checkoutHoldExpiry(f.container);
    expect(f.state()).toBe("expired");
  });

  it("retains an existing bank payment even when its notification is delayed", async () => {
    jest.spyOn(TBankClient.prototype, "checkOrder").mockResolvedValue({
      Success: true, ErrorCode: "0", OrderId: "session_1", Payments: [{ PaymentId: "bank_1", Status: "CONFIRMED" }],
    });
    const f = fixture();
    await checkoutHoldExpiry(f.container);
    expect(f.state()).toBe("expired");
  });

  it("cannot release an old-terminal allocation using the new terminal's answer", async () => {
    jest.spyOn(TBankClient.prototype, "checkOrder").mockResolvedValue({
      Success: true, ErrorCode: "0", OrderId: "session_1", Payments: [],
    });
    const f = fixture("old-terminal");
    await checkoutHoldExpiry(f.container);
    expect(f.state()).toBe("expired");
  });
});
