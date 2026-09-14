import { createServer, type ServerResponse } from "node:http";

import { GET } from "../../medusa-prototype/apps/backend/src/api/store/payment-status/[cartId]/route";

const CARTS = {
  pending: "cart_01J00000000000000000000000",
  confirmed: "cart_01J00000000000000000000001",
  ready: "cart_01J00000000000000000000002",
  failed: "cart_01J00000000000000000000003",
  foreign: "cart_01J00000000000000000000004",
} as const;

type FixtureState = "pending" | "confirmed" | "ready" | "failed" | "foreign" | "unknown";

function stateForCart(cartId: string): FixtureState {
  switch (cartId) {
    case CARTS.pending:
      return "pending";
    case CARTS.confirmed:
      return "confirmed";
    case CARTS.ready:
      return "ready";
    case CARTS.failed:
      return "failed";
    case CARTS.foreign:
      return "foreign";
    default:
      return "unknown";
  }
}

function sendJson(response: ServerResponse, statusCode: number, body: object): void {
  response.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

async function main(): Promise<void> {
  let bankCalls = 0;
  const server = createServer(async (request, response) => {
    const requestUrl = new URL(request.url ?? "/", "http://fixture.local");
    if (requestUrl.pathname === "/health") {
      sendJson(response, 200, { status: "ready" });
      return;
    }
    if (requestUrl.pathname === "/__control/observations") {
      sendJson(response, 200, { bank_calls: bankCalls });
      return;
    }

    const prefix = "/store/payment-status/";
    if (request.method !== "GET" || !requestUrl.pathname.startsWith(prefix)) {
      response.writeHead(404);
      response.end();
      return;
    }
    const cartId = decodeURIComponent(requestUrl.pathname.slice(prefix.length));
    const state = stateForCart(cartId);
    const collectionId = `pay_col_fixture_${state}`;
    const sessionId = `payses_fixture_${state}`;
    const query = {
      graph: async ({ entity }: { readonly entity: string }) => {
        switch (entity) {
          case "cart_payment_collection":
            return state === "unknown"
              ? { data: [] }
              : { data: [{ cart_id: cartId, payment_collection_id: collectionId }] };
          case "payment_session":
            return { data: [{
              id: sessionId,
              payment_collection_id: state === "foreign" ? "pay_col_fixture_other" : collectionId,
              provider_id: "pp_tbank_tbank",
              status: state === "failed" ? "error" : "pending_authorization",
            }] };
          case "payment":
            return state === "confirmed" || state === "ready"
              ? { data: [{ payment_session_id: sessionId, captured_at: "2026-09-13T00:00:00.000Z" }] }
              : { data: [] };
          case "order_cart":
            return state === "ready"
              ? { data: [{ cart_id: cartId, order_id: "order_fixture_ready" }] }
              : { data: [] };
          default:
            throw new Error(`Unexpected fixture query entity ${entity}`);
        }
      },
    };
    const attempts = {
      listTbankPaymentAttempts: async () => [{
        id: `tbatt_fixture_${state}`,
        payment_session_id: sessionId,
        provider_id: "pp_tbank_tbank",
      }],
    };
    const scope = {
      resolve: (key: string) => {
        if (key === "query") return query;
        if (key === "tbankNotification") return attempts;
        bankCalls += 1;
        throw new Error(`Forbidden fixture dependency ${key}`);
      },
    };
    const routeResponse = {
      setHeader: (name: string, value: string) => {
        response.setHeader(name, value);
        return routeResponse;
      },
      status: (statusCode: number) => {
        response.statusCode = statusCode;
        return routeResponse;
      },
      json: (body: object) => {
        response.setHeader("Content-Type", "application/json; charset=utf-8");
        response.end(JSON.stringify(body));
        return routeResponse;
      },
      end: () => {
        response.end();
        return routeResponse;
      },
    };
    await Reflect.apply(GET, null, [{ params: { cartId }, scope }, routeResponse]);
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(4174, "127.0.0.1", resolve);
  });
  const close = (): void => {
    server.close();
  };
  process.once("SIGINT", close);
  process.once("SIGTERM", close);
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
