import { GET } from "../route";

const CART_ID = "cart_01J00000000000000000000000";
const PAYMENT_COLLECTION_ID = "pay_col_01J00000000000000000000000";
const PAYMENT_SESSION_ID = "payses_01J00000000000000000000000";

type Scenario = {
  readonly cartLinks?: readonly Record<string, unknown>[];
  readonly sessions?: readonly Record<string, unknown>[];
  readonly attempts?: readonly Record<string, unknown>[];
  readonly payments?: readonly Record<string, unknown>[];
  readonly orders?: readonly Record<string, unknown>[];
};

type ResponseHarness = {
  body: unknown;
  statusCode: number;
  readonly headers: Map<string, string>;
  readonly setHeader: jest.Mock;
  readonly status: jest.Mock;
  readonly json: jest.Mock;
  readonly end: jest.Mock;
};

function scenario(overrides: Scenario = {}): Required<Scenario> {
  return {
    cartLinks: [{ cart_id: CART_ID, payment_collection_id: PAYMENT_COLLECTION_ID }],
    sessions: [{
      id: PAYMENT_SESSION_ID,
      payment_collection_id: PAYMENT_COLLECTION_ID,
      provider_id: "pp_tbank_tbank",
      status: "pending_authorization",
    }],
    attempts: [{
      id: "tbatt_01J00000000000000000000000",
      payment_session_id: PAYMENT_SESSION_ID,
      provider_id: "pp_tbank_tbank",
    }],
    payments: [],
    orders: [],
    ...overrides,
  };
}

function routeHarness(input: { readonly cartId: string; readonly scenario: Required<Scenario> }) {
  const graph = jest.fn(async ({ entity }: { readonly entity: string }) => {
    switch (entity) {
      case "cart_payment_collection":
        return { data: input.scenario.cartLinks };
      case "payment_session":
        return { data: input.scenario.sessions };
      case "payment":
        return { data: input.scenario.payments };
      case "order_cart":
        return { data: input.scenario.orders };
      default:
        throw new Error(`Unexpected query entity ${entity}`);
    }
  });
  const listTbankPaymentAttempts = jest.fn().mockResolvedValue(input.scenario.attempts);
  const bankGetState = jest.fn();
  const resolve = jest.fn((key: string) => {
    if (key === "query") return { graph };
    if (key === "tbankNotification") return { listTbankPaymentAttempts };
    if (key.includes("tbank")) return { getState: bankGetState };
    throw new Error(`Unexpected container dependency ${key}`);
  });
  const request = { params: { cartId: input.cartId }, scope: { resolve } };
  let response: ResponseHarness;
  response = {
    body: undefined,
    statusCode: 200,
    headers: new Map<string, string>(),
    setHeader: jest.fn((name: string, value: string) => {
      response.headers.set(name.toLowerCase(), value);
      return response;
    }),
    status: jest.fn((statusCode: number) => {
      response.statusCode = statusCode;
      return response;
    }),
    json: jest.fn((body: unknown) => {
      response.body = body;
      return response;
    }),
    end: jest.fn(() => response),
  };
  return { request, response, graph, listTbankPaymentAttempts, bankGetState, resolve };
}

describe("GET /store/payment-status/:cartId", () => {
  it.each([
    ["pending", scenario(), { payment: "pending", order: "pending" }],
    [
      "confirmed with order pending",
      scenario({ payments: [{ payment_session_id: PAYMENT_SESSION_ID, captured_at: new Date() }] }),
      { payment: "confirmed", order: "pending" },
    ],
    [
      "confirmed with order ready",
      scenario({
        payments: [{ payment_session_id: PAYMENT_SESSION_ID, captured_at: new Date() }],
        orders: [{ cart_id: CART_ID, order_id: "order_01J00000000000000000000000" }],
      }),
      { payment: "confirmed", order: "ready" },
    ],
    [
      "failed",
      scenario({ sessions: [{
        id: PAYMENT_SESSION_ID,
        payment_collection_id: PAYMENT_COLLECTION_ID,
        provider_id: "pp_tbank_tbank",
        status: "error",
      }] }),
      { payment: "failed", order: "pending" },
    ],
  ])("returns the exact minimal %s projection from local durable state", async (_name, state, expected) => {
    const harness = routeHarness({ cartId: CART_ID, scenario: state });

    await Reflect.apply(GET, null, [harness.request, harness.response]);

    expect(harness.response.statusCode).toBe(200);
    expect(harness.response.body).toEqual(expected);
    expect(harness.response.headers.get("cache-control")).toBe("no-store, no-cache, must-revalidate, proxy-revalidate");
    expect(harness.resolve).toHaveBeenCalledTimes(2);
    expect(harness.bankGetState).not.toHaveBeenCalled();
  });

  it.each([
    ["malformed", "pay_3456789", scenario()],
    ["missing", "", scenario()],
    ["bank PaymentId", "3456789", scenario()],
    ["T-Bank OrderId", PAYMENT_SESSION_ID, scenario()],
    ["Medusa order ID", "order_01J00000000000000000000000", scenario()],
    ["payment-session ID", "payses_01J00000000000000000000000", scenario()],
    ["forged unknown", CART_ID, scenario({ cartLinks: [] })],
    [
      "foreign relation",
      CART_ID,
      scenario({
        sessions: [{
          id: "payses_foreign",
          payment_collection_id: "pay_col_foreign",
          provider_id: "pp_tbank_tbank",
          status: "captured",
        }],
        attempts: [{
          id: "tbatt_foreign",
          payment_session_id: "payses_foreign",
          provider_id: "pp_tbank_tbank",
        }],
        payments: [{ payment_session_id: "payses_foreign", captured_at: new Date() }],
        orders: [{ cart_id: "cart_foreign", order_id: "order_foreign" }],
      }),
    ],
  ])("rejects a %s cart capability with the same non-enumerating contract", async (_name, cartId, state) => {
    const harness = routeHarness({ cartId, scenario: state });

    await Reflect.apply(GET, null, [harness.request, harness.response]);

    expect(harness.response.statusCode).toBe(404);
    expect(harness.response.body).toBeUndefined();
    expect(harness.response.end).toHaveBeenCalledTimes(1);
    expect(harness.response.headers.get("cache-control")).toBe("no-store, no-cache, must-revalidate, proxy-revalidate");
    expect(harness.bankGetState).not.toHaveBeenCalled();
  });

  it("does not treat AUTHORIZED as paid evidence", async () => {
    const harness = routeHarness({
      cartId: CART_ID,
      scenario: scenario({ sessions: [{
        id: PAYMENT_SESSION_ID,
        payment_collection_id: PAYMENT_COLLECTION_ID,
        provider_id: "pp_tbank_tbank",
        status: "authorized",
      }] }),
    });

    await Reflect.apply(GET, null, [harness.request, harness.response]);

    expect(harness.response.body).toEqual({ payment: "pending", order: "pending" });
    expect(harness.bankGetState).not.toHaveBeenCalled();
  });

  it("accepts payment attempt with provider_id 'tbank' (legacy/service format)", async () => {
    const harness = routeHarness({
      cartId: CART_ID,
      scenario: scenario({
        attempts: [{
          id: "tbatt_01J00000000000000000000000",
          payment_session_id: PAYMENT_SESSION_ID,
          provider_id: "tbank",
        }],
        payments: [{ payment_session_id: PAYMENT_SESSION_ID, captured_at: new Date() }],
      }),
    });

    await Reflect.apply(GET, null, [harness.request, harness.response]);

    expect(harness.response.statusCode).toBe(200);
    expect(harness.response.body).toEqual({ payment: "confirmed", order: "pending" });
  });
});
