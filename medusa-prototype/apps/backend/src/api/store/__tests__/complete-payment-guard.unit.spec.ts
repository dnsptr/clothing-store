import { requireCapturedTbankPayment } from "../complete-payment-guard";

const cartId = "cart_01J00000000000000000000000";
const collectionId = "paycol_01J00000000000000000000000";
const sessionId = "payses_01J00000000000000000000000";
const link = { cart_id: cartId, payment_collection_id: collectionId };
const session = {
  id: sessionId,
  payment_collection_id: collectionId,
  provider_id: "pp_tbank_tbank",
  status: "pending_authorization",
};
const attempt = { payment_session_id: sessionId, provider_id: "pp_tbank_tbank" };

type State = {
  readonly links?: readonly Record<string, unknown>[];
  readonly reverseLinks?: readonly Record<string, unknown>[];
  readonly sessions?: readonly Record<string, unknown>[];
  readonly attempts?: readonly Record<string, unknown>[];
  readonly payments?: readonly Record<string, unknown>[];
  readonly orders?: readonly Record<string, unknown>[];
};

function harness(state: State = {}) {
  const rows: Required<State> = {
    links: [link], reverseLinks: [link], sessions: [session], attempts: [attempt],
    payments: [], orders: [], ...state,
  };
  const graph = jest.fn(async ({ entity, filters }: { entity: string; filters: Record<string, unknown> }) => {
    switch (entity) {
      case "cart_payment_collection":
        return { data: filters.payment_collection_id ? rows.reverseLinks : rows.links };
      case "payment_session": return { data: rows.sessions };
      case "payment": return { data: rows.payments };
      case "order_cart": return { data: rows.orders };
      default: throw new Error(`Unexpected graph entity: ${entity}`);
    }
  });
  const listTbankPaymentAttempts = jest.fn().mockResolvedValue(rows.attempts);
  const resolve = jest.fn((name: string) => {
    if (name === "query") return { graph };
    if (name === "tbankNotification") return { listTbankPaymentAttempts };
    throw new Error(`Unexpected dependency: ${name}`);
  });
  const next = jest.fn();
  const response = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
  const request = { params: { id: cartId }, scope: { resolve } };
  const run = () => Reflect.apply(requireCapturedTbankPayment, null, [request, response, next]);
  return { run, next, response, graph, listTbankPaymentAttempts };
}

describe("POST /store/carts/:id/complete payment guard", () => {
  it.each([
    ["pending", {}],
    ["authorized without capture", { sessions: [{ ...session, status: "authorized" }] }],
    ["failed", { sessions: [{ ...session, status: "error" }] }],
    ["missing durable attempt", { attempts: [] }],
    ["missing cart linkage", { links: [] }],
    ["forged cart linkage", { links: [{ cart_id: "cart_other", payment_collection_id: collectionId }] }],
    ["collection shared with another cart", { reverseLinks: [link, { cart_id: "cart_other", payment_collection_id: collectionId }] }],
    ["collection belongs to a different cart", { reverseLinks: [{ cart_id: "cart_other", payment_collection_id: collectionId }] }],
    ["foreign payment session", { sessions: [{ ...session, payment_collection_id: "paycol_other" }], payments: [{ payment_session_id: sessionId, captured_at: new Date() }] }],
    ["foreign capture", { payments: [{ payment_session_id: "payses_other", captured_at: new Date() }] }],
    ["system default alongside TBank", { sessions: [session, { ...session, id: "payses_free", provider_id: "pp_system_default" }], payments: [{ payment_session_id: sessionId, captured_at: new Date() }] }],
  ])("blocks %s without completing the cart", async (_name, state) => {
    const fixture = harness(state);
    await fixture.run();
    expect(fixture.response.status).toHaveBeenCalledWith(400);
    expect(fixture.next).not.toHaveBeenCalled();
  });

  it("blocks HTTP completion after capture until the webhook creates the order", async () => {
    const fixture = harness({
      payments: [{ payment_session_id: sessionId, captured_at: new Date() }],
    });
    await fixture.run();
    expect(fixture.response.status).toHaveBeenCalledWith(400);
    expect(fixture.next).not.toHaveBeenCalled();
  });

  it("does not accept a foreign order link as post-capture idempotency proof", async () => {
    const fixture = harness({
      payments: [{ payment_session_id: sessionId, captured_at: new Date() }],
      orders: [{ cart_id: "cart_other", order_id: "order_other" }],
    });
    await fixture.run();
    expect(fixture.response.status).toHaveBeenCalledWith(400);
    expect(fixture.next).not.toHaveBeenCalled();
  });

  it("allows repeated post-capture completion for the same linked cart", async () => {
    const fixture = harness({
      payments: [{ payment_session_id: sessionId, captured_at: new Date() }],
      orders: [{ cart_id: cartId, order_id: "order_01J00000000000000000000000" }],
    });
    await fixture.run();
    await fixture.run();
    expect(fixture.next).toHaveBeenCalledTimes(2);
    expect(fixture.response.status).not.toHaveBeenCalled();
    expect(fixture.listTbankPaymentAttempts).toHaveBeenCalledTimes(2);
  });

  it("preserves another paid provider but blocks the free system provider", async () => {
    const paid = harness({ sessions: [{ ...session, provider_id: "pp_stripe_stripe" }] });
    await paid.run();
    expect(paid.next).toHaveBeenCalledTimes(1);
    expect(paid.listTbankPaymentAttempts).not.toHaveBeenCalled();

    const free = harness({ sessions: [{ ...session, provider_id: "pp_system_default" }] });
    await free.run();
    expect(free.next).not.toHaveBeenCalled();
    expect(free.response.status).toHaveBeenCalledWith(400);
  });
});
