import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

export const BANK_PAYMENT_URL = "https://bank.test/payment/payses_baseline";
export const DEFAULT_FIXTURE_URL = "http://127.0.0.1:4174";

export const PAYMENT_SCENARIOS = [
  "valid",
  "malformed",
  "insecure",
  "missing",
  "wrong_status",
  "wrong_provider",
] as const;

export type PaymentScenario = (typeof PAYMENT_SCENARIOS)[number];

type RequestObservation = {
  readonly method: string;
  readonly path: string;
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

function parseScenario(value: unknown): PaymentScenario | null {
  switch (value) {
    case "valid":
    case "malformed":
    case "insecure":
    case "missing":
    case "wrong_status":
    case "wrong_provider":
      return value;
    default:
      return null;
  }
}

function sessionFor(scenario: PaymentScenario): object {
  switch (scenario) {
    case "valid":
      return { id: "payses_baseline", provider_id: "pp_tbank_tbank", status: "pending_authorization", data: { paymentUrl: BANK_PAYMENT_URL } };
    case "malformed":
      return { id: "payses_baseline", provider_id: "pp_tbank_tbank", status: "pending_authorization", data: { paymentUrl: "://malformed-payment-url" } };
    case "insecure":
      return { id: "payses_baseline", provider_id: "pp_tbank_tbank", status: "pending_authorization", data: { paymentUrl: "http://bank.test/payment/payses_baseline" } };
    case "missing":
      return { id: "payses_baseline", provider_id: "pp_tbank_tbank", status: "pending_authorization", data: {} };
    case "wrong_status":
      return { id: "payses_baseline", provider_id: "pp_tbank_tbank", status: "authorized", data: { paymentUrl: BANK_PAYMENT_URL } };
    case "wrong_provider":
      return { id: "payses_baseline", provider_id: "pp_other_other", status: "pending_authorization", data: { paymentUrl: BANK_PAYMENT_URL } };
  }
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (chunks.length === 0) return null;
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export async function startStoreApiFixture(port: number): Promise<StoreApiFixture> {
  let scenario: PaymentScenario = "valid";
  let observations: RequestObservation[] = [];
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
    if (requestUrl.pathname === "/__control/observations") {
      sendJson(response, 200, { observations });
      return;
    }

    observations.push({ method, path: requestUrl.pathname });
    if (requestUrl.pathname === "/store/products") {
      sendJson(response, 200, { products: [PRODUCT], count: 1 });
      return;
    }
    if (requestUrl.pathname === "/store/carts/cart_baseline") {
      sendJson(response, 200, { cart: CART });
      return;
    }
    if (requestUrl.pathname === "/store/shipping-options") {
      sendJson(response, 200, { shipping_options: [{ id: "shipping_baseline", name: "Fixture delivery", amount: 0 }] });
      return;
    }
    if (requestUrl.pathname === "/store/carts/cart_baseline/shipping-methods") {
      sendJson(response, 200, { cart: CART });
      return;
    }
    if (requestUrl.pathname === "/store/payment-collections") {
      sendJson(response, 200, { payment_collection: { id: "paycol_baseline" } });
      return;
    }
    if (requestUrl.pathname === "/store/payment-collections/paycol_baseline/payment-sessions") {
      sendJson(response, 200, { payment_collection: { id: "paycol_baseline", payment_sessions: [sessionFor(scenario)] } });
      return;
    }
    if (requestUrl.pathname === "/store/carts/cart_baseline/complete") {
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
