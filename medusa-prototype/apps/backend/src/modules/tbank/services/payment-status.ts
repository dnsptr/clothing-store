import {
  TBANK_PAYMENT_PROVIDER_ID,
  TBANK_PROVIDER_IDENTIFIER,
} from "../provider-id";

export type PaymentStatusView =
  | { readonly payment: "pending"; readonly order: "pending" }
  | { readonly payment: "failed"; readonly order: "pending" }
  | { readonly payment: "confirmed"; readonly order: "pending" | "ready" };

export type PaymentStatusResult =
  | { readonly kind: "found"; readonly value: PaymentStatusView }
  | { readonly kind: "not_found" };

export type PaymentStatusQuery = {
  graph(input: {
    readonly entity: string;
    readonly fields: readonly string[];
    readonly filters: Readonly<Record<string, unknown>>;
  }): Promise<{ readonly data: readonly Record<string, unknown>[] }>;
};

export type PaymentAttemptReader = {
  listTbankPaymentAttempts(
    filters: Readonly<Record<string, unknown>>,
  ): Promise<readonly Record<string, unknown>[]>;
};

type PaymentStatusDependencies = {
  readonly query: PaymentStatusQuery;
  readonly attempts: PaymentAttemptReader;
};

const TERMINAL_FAILURES = ["error", "canceled"] as const;

function field(row: Record<string, unknown>, name: string): string | undefined {
  const value = row[name];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export async function readPaymentStatus(
  dependencies: PaymentStatusDependencies,
  cartId: string,
): Promise<PaymentStatusResult> {
  const cartLinks = await dependencies.query.graph({
    entity: "cart_payment_collection",
    fields: ["cart_id", "payment_collection_id"],
    filters: { cart_id: cartId },
  });
  const collectionIds = cartLinks.data.flatMap((row) => {
    const linkedCartId = field(row, "cart_id");
    const collectionId = field(row, "payment_collection_id");
    return linkedCartId === cartId && collectionId ? [collectionId] : [];
  });
  if (collectionIds.length === 0) return { kind: "not_found" };

  const sessions = (await Promise.all(collectionIds.map(async (paymentCollectionId) => {
    const result = await dependencies.query.graph({
      entity: "payment_session",
      fields: ["id", "payment_collection_id", "provider_id", "status"],
      filters: { payment_collection_id: paymentCollectionId },
    });
    return result.data.filter((row) =>
      field(row, "payment_collection_id") === paymentCollectionId &&
      field(row, "provider_id") === TBANK_PAYMENT_PROVIDER_ID,
    );
  }))).flat();

  const relatedSessions = (await Promise.all(sessions.map(async (session) => {
    const sessionId = field(session, "id");
    if (!sessionId) return [];
    const attempts = await dependencies.attempts.listTbankPaymentAttempts({
      payment_session_id: sessionId,
    });
    const hasMatchingAttempt = attempts.some((attempt) => {
      const providerId = field(attempt, "provider_id");
      return (
        field(attempt, "payment_session_id") === sessionId &&
        (providerId === TBANK_PAYMENT_PROVIDER_ID ||
          providerId === TBANK_PROVIDER_IDENTIFIER)
      );
    });
    return hasMatchingAttempt ? [{ sessionId, status: field(session, "status") }] : [];
  }))).flat();
  if (relatedSessions.length === 0) return { kind: "not_found" };

  const captured = await Promise.all(relatedSessions.map(async ({ sessionId }) => {
    const result = await dependencies.query.graph({
      entity: "payment",
      fields: ["payment_session_id", "captured_at"],
      filters: { payment_session_id: sessionId },
    });
    return result.data.some((payment) =>
      field(payment, "payment_session_id") === sessionId &&
      payment["captured_at"] !== null &&
      payment["captured_at"] !== undefined,
    );
  }));

  if (captured.some(Boolean)) {
    const orders = await dependencies.query.graph({
      entity: "order_cart",
      fields: ["cart_id", "order_id"],
      filters: { cart_id: cartId },
    });
    const orderReady = orders.data.some((row) =>
      field(row, "cart_id") === cartId && field(row, "order_id") !== undefined,
    );
    return { kind: "found", value: { payment: "confirmed", order: orderReady ? "ready" : "pending" } };
  }

  const hasPending = relatedSessions.some(({ status }) =>
    !status || !TERMINAL_FAILURES.some((terminalStatus) => terminalStatus === status),
  );
  return {
    kind: "found",
    value: { payment: hasPending ? "pending" : "failed", order: "pending" },
  };
}
