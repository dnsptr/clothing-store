import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

export const BANK_PAYMENT_URL = "https://securepay.tinkoff.ru/payment/payses_baseline";
export const DEFAULT_FIXTURE_URL = "http://127.0.0.1:4174";

export const PAYMENT_SCENARIOS = [
  "valid",
  "malformed",
  "insecure",
  "missing",
  "wrong_status",
  "wrong_provider",
  "unapproved",
  "credentials",
] as const;

export const FIXTURE_RETURN_CARTS = {
  pending: "cart_01J00000000000000000000000",
  confirmed: "cart_01J00000000000000000000001",
  ready: "cart_01J00000000000000000000002",
  failed: "cart_01J00000000000000000000003",
  foreign: "cart_01J00000000000000000000004",
} as const;

export type PaymentScenario = (typeof PAYMENT_SCENARIOS)[number];

type RequestObservation = {
  readonly method: string;
  readonly path: string;
};

type FixturePaymentSession = {
  readonly id: string;
  readonly provider_id: string;
  readonly status: string;
  readonly data: Record<string, string>;
};

export type StoreApiFixture = {
  readonly url: string;
  readonly close: () => Promise<void>;
};

export class FixtureServerError extends Error {
  readonly name = "FixtureServerError";
}

const CART = {
  id: "cart_baseline",
  total: 1899,
  subtotal: 1899,
  tax_total: 0,
  discount_total: 0,
  shipping_total: 0,
  items: [{
    id: "item_baseline",
    title: "Baseline coat",
    variant_id: "variant_baseline",
    variant_sku: "BASELINE-COAT-M",
    variant_title: "M",
    product_id: "prod_baseline",
    product_title: "Baseline coat",
    product_handle: "mario-mikke-baseline-coat",
    quantity: 1,
    unit_price: 1899,
    total: 1899,
  }],
} as const;

const PRODUCT = {
  id: "prod_baseline",
  title: "Baseline coat",
  handle: "mario-mikke-baseline-coat",
  metadata: { frontend_id: "baseline-coat", colors: [{ name: "Black", hex: "#111111" }] },
  images: [],
  categories: [{ name: "Outerwear", handle: "outerwear" }],
  options: [{ id: "option_size", title: "Размер", values: [{ value: "M" }] }],
  variants: [{
    id: "variant_baseline",
    sku: "BASELINE-COAT-M",
    manage_inventory: true,
    allow_backorder: false,
    inventory_quantity: 2,
    calculated_price: { calculated_amount: 1899 },
    options: [{ value: "M", option_id: "option_size" }],
  }],
} as const;

function sendJson(response: ServerResponse, status: number, value: object): void {
  response.writeHead(status, {
    "access-control-allow-headers": "content-type,x-publishable-api-key",
    "access-control-allow-methods": "GET,POST,DELETE,OPTIONS",
    "access-control-allow-origin": "*",
    "content-type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseScenario(value: unknown): PaymentScenario | null {
  switch (value) {
    case "valid":
    case "malformed":
    case "insecure":
    case "missing":
    case "wrong_status":
    case "wrong_provider":
    case "unapproved":
    case "credentials":
      return value;
    default:
      return null;
  }
}

function sessionFor(
  scenario: PaymentScenario,
  id: string,
  statusOverride?: string,
): FixturePaymentSession {
  const status = statusOverride ?? (scenario === "wrong_status" ? "authorized" : "pending_authorization");
  const paymentUrl = id === "payses_baseline"
    ? BANK_PAYMENT_URL
    : `https://securepay.tinkoff.ru/payment/${id}`;
  switch (scenario) {
    case "valid":
      return { id, provider_id: "pp_tbank_tbank", status, data: { paymentUrl } };
    case "malformed":
      return { id, provider_id: "pp_tbank_tbank", status, data: { paymentUrl: "://malformed-payment-url" } };
    case "insecure":
      return { id, provider_id: "pp_tbank_tbank", status, data: { paymentUrl: `http://bank.test/payment/${id}` } };
    case "missing":
      return { id, provider_id: "pp_tbank_tbank", status, data: {} };
    case "wrong_status":
      return { id, provider_id: "pp_tbank_tbank", status, data: { paymentUrl } };
    case "wrong_provider":
      return { id, provider_id: "pp_other_other", status, data: { paymentUrl } };
    case "unapproved":
      return { id, provider_id: "pp_tbank_tbank", status, data: { paymentUrl: `https://bank.test/payment/${id}` } };
    case "credentials":
      return { id, provider_id: "pp_tbank_tbank", status, data: { paymentUrl: `https://user:password@securepay.tinkoff.ru/payment/${id}` } };
  }
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const text = Buffer.concat(chunks).toString("utf8").trim();
  if (text.length === 0) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export async function startStoreApiFixture(port: number): Promise<StoreApiFixture> {
  let scenario: PaymentScenario = "valid";
  let observations: RequestObservation[] = [];
  let paymentSessions: FixturePaymentSession[] = [];
  let paymentSessionInitializations = 0;
  let dropNextPaymentSessionResponse = false;
  let customSessionControl = false;
  const statusOverrides = new Map<string, object | "not_found">();
  const server = createServer(async (request, response) => {
    const requestUrl = new URL(request.url ?? "/", "http://fixture.local");
    const method = request.method ?? "GET";
    if (method === "OPTIONS") {
      sendJson(response, 204, {});
      return;
    }
    if (requestUrl.pathname === "/health") {
      sendJson(response, 200, { status: "ready" });
      return;
    }
    if (requestUrl.pathname === "/__control/reset" && method === "POST") {
      observations = [];
      paymentSessions = [];
      paymentSessionInitializations = 0;
      dropNextPaymentSessionResponse = false;
      customSessionControl = false;
      statusOverrides.clear();
      sendJson(response, 200, { reset: true });
      return;
    }
    if (requestUrl.pathname === "/__control/scenario" && method === "POST") {
      const body = await readJsonBody(request);
      const nextScenario = body && typeof body === "object" && "scenario" in body
        ? parseScenario(body.scenario)
        : null;
      if (nextScenario === null) {
        sendJson(response, 400, { error: "invalid_scenario" });
        return;
      }
      scenario = nextScenario;
      sendJson(response, 200, { scenario });
      return;
    }
    if (requestUrl.pathname === "/__control/payment-status" && method === "POST") {
      const body = (await readJsonBody(request)) as { cartId?: string; status?: object | "not_found" } | null;
      if (body?.cartId) {
        if (body.status === undefined || body.status === null) {
          statusOverrides.delete(body.cartId);
        } else {
          statusOverrides.set(body.cartId, body.status);
        }
        sendJson(response, 200, { updated: true });
        return;
      }
      sendJson(response, 400, { error: "missing_cart_id" });
      return;
    }
    if (requestUrl.pathname === "/__control/payment-session" && method === "POST") {
      const body = await readJsonBody(request);
      if (!isRecord(body)) {
        sendJson(response, 400, { error: "invalid_payment_session_control" });
        return;
      }

      const { dropNextResponse, status } = body;
      if (dropNextResponse !== undefined && typeof dropNextResponse !== "boolean") {
        sendJson(response, 400, { error: "invalid_drop_next_response" });
        return;
      }
      if (status !== undefined && typeof status !== "string") {
        sendJson(response, 400, { error: "invalid_payment_session_status" });
        return;
      }

      customSessionControl = true;
      if (typeof dropNextResponse === "boolean") dropNextPaymentSessionResponse = dropNextResponse;
      if (typeof status === "string") {
        paymentSessions = [sessionFor(scenario, "payses_terminal", status)];
      }
      sendJson(response, 200, { updated: true });
      return;
    }
    if (requestUrl.pathname === "/__control/observations") {
      sendJson(response, 200, { observations, paymentSessionInitializations, paymentSessions });
      return;
    }

    observations.push({ method, path: requestUrl.pathname });
    if (requestUrl.pathname === "/store/products") {
      sendJson(response, 200, { products: [PRODUCT], count: 1 });
      return;
    }

    const paymentStatusPrefix = "/store/payment-status/";
    if (requestUrl.pathname.startsWith(paymentStatusPrefix)) {
      const cartId = decodeURIComponent(requestUrl.pathname.slice(paymentStatusPrefix.length));
      response.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");

      if (statusOverrides.has(cartId)) {
        const override = statusOverrides.get(cartId);
        if (override === "not_found") {
          sendJson(response, 404, { error: "cart_not_found" });
          return;
        }
        sendJson(response, 200, override as object);
        return;
      }

      if (cartId === FIXTURE_RETURN_CARTS.pending) {
        sendJson(response, 200, { payment: "pending", order: "pending" });
        return;
      }
      if (cartId === FIXTURE_RETURN_CARTS.confirmed) {
        sendJson(response, 200, { payment: "confirmed", order: "pending" });
        return;
      }
      if (cartId === FIXTURE_RETURN_CARTS.ready) {
        sendJson(response, 200, { payment: "confirmed", order: "ready" });
        return;
      }
      if (cartId === FIXTURE_RETURN_CARTS.failed) {
        sendJson(response, 200, { payment: "failed", order: "pending" });
        return;
      }
      sendJson(response, 404, { error: "cart_not_found" });
      return;
    }

    if (
      requestUrl.pathname.startsWith("/store/carts/") &&
      !requestUrl.pathname.includes("/shipping-methods") &&
      !requestUrl.pathname.includes("/complete") &&
      !requestUrl.pathname.includes("/line-items")
    ) {
      const id = requestUrl.pathname.slice("/store/carts/".length);
      sendJson(response, 200, { cart: { ...CART, id } });
      return;
    }
    if (requestUrl.pathname === "/store/shipping-options") {
      sendJson(response, 200, { shipping_options: [{ id: "shipping_baseline", name: "Fixture delivery", amount: 0 }] });
      return;
    }
    if (requestUrl.pathname.startsWith("/store/carts/") && requestUrl.pathname.endsWith("/shipping-methods")) {
      const id = requestUrl.pathname.slice("/store/carts/".length, -"/shipping-methods".length);
      sendJson(response, 200, { cart: { ...CART, id } });
      return;
    }
    if (requestUrl.pathname === "/store/payment-collections") {
      sendJson(response, 200, { payment_collection: { id: "paycol_baseline", payment_sessions: paymentSessions } });
      return;
    }
    if (requestUrl.pathname === "/store/payment-collections/paycol_baseline/payment-sessions") {
      paymentSessionInitializations += 1;
      const sessionId = customSessionControl
        ? `payses_fixture_${paymentSessionInitializations}`
        : "payses_baseline";
      paymentSessions = [sessionFor(scenario, sessionId)];
      if (dropNextPaymentSessionResponse) {
        dropNextPaymentSessionResponse = false;
        sendJson(response, 502, { error: "provider_network_error", message: "Response from provider was lost" });
        return;
      }
      sendJson(response, 200, { payment_collection: { id: "paycol_baseline", payment_sessions: paymentSessions } });
      return;
    }
    if (requestUrl.pathname.startsWith("/store/carts/") && requestUrl.pathname.endsWith("/complete")) {
      sendJson(response, 200, { type: "order", order: { id: "order_unexpected" } });
      return;
    }
    sendJson(response, 404, { error: "route_not_found" });
  });

  await new Promise<void>((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(port, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new FixtureServerError("Store API fixture did not bind a TCP port");
  }
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolveClose, rejectClose) => {
      server.close((error) => error ? rejectClose(error) : resolveClose());
    }),
  };
}
