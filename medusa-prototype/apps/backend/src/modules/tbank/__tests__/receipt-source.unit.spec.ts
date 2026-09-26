import { TBankReceiptSource } from "../lib/receipt-source";

const SNAPSHOT_SECRET = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=";
const receiptCart = {
  id: "cart_shared",
  email: "receipt@example.com",
  total: 100,
  shipping_total: 0,
  items: [{ id: "item_1", product_title: "Платье", quantity: 1, total: 100 }],
};

function receiptQuery() {
  return {
    graph: jest.fn().mockImplementation(async (request: {
      readonly entity: string;
      readonly filters: Readonly<Record<string, unknown>>;
    }) => {
      if (request.entity === "payment_session") {
        return {
          data: [{
            id: request.filters.id,
            payment_collection_id: `collection_${String(request.filters.id)}`,
          }],
        };
      }
      if (request.entity === "cart_payment_collection") {
        return {
          data: [{
            cart_id: receiptCart.id,
            payment_collection_id: request.filters.payment_collection_id,
          }],
        };
      }
      return { data: [receiptCart] };
    }),
  };
}

describe("TBankReceiptSource snapshot scope", () => {
  it("reopens a trusted snapshot for the same payment session", async () => {
    const source = new TBankReceiptSource(receiptQuery() as never, SNAPSHOT_SECRET);
    const first = await source.resolve({ sessionId: "session_a", paymentAmountKopecks: 10_000 });

    const retry = await source.resolve({
      sessionId: "session_a",
      existingSnapshotEnvelope: first.snapshotEnvelope,
      paymentAmountKopecks: 10_000,
    });

    expect(retry.receipt).toEqual(first.receipt);
  });

  it("rejects a trusted snapshot replayed into another payment session", async () => {
    const source = new TBankReceiptSource(receiptQuery() as never, SNAPSHOT_SECRET);
    const first = await source.resolve({ sessionId: "session_a", paymentAmountKopecks: 10_000 });

    await expect(source.resolve({
      sessionId: "session_b",
      existingSnapshotEnvelope: first.snapshotEnvelope,
      paymentAmountKopecks: 10_000,
    })).rejects.toThrow(/сессии/i);
  });
});
