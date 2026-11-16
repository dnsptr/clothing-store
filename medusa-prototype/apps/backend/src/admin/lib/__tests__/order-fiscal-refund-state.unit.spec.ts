import { clearFiscalAttempt, isDefinitiveRequestRejection, isFiscalOperationSettled, readFiscalAttempt, rejectFiscalAttempt, retainFiscalAttempt, type FiscalAttempt } from "../order-fiscal-refund-state";
import type { RefundOperationSummary } from "../../../modules/tbank/refund-contracts";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
}
const attempt: FiscalAttempt = {
  payment_id: "pay_1", kind: "refund",
  body: { idempotency_key: "stable_attempt", receipt_mode: "full_payment", note: "Buyer return",
    items: [{ line_index: 1, quantity: 1, mark_codes: ["actual\u001dcode"] }] },
};

describe("admin fiscal retry consumer", () => {
  it("retains the exact key, selections, codes and mode across timeout/reload", () => {
    const storage = memoryStorage();
    retainFiscalAttempt(storage, attempt);
    // No response is required to recover the original request after a timeout.
    expect(readFiscalAttempt(storage, "pay_1")).toEqual(attempt);
    expect(readFiscalAttempt(storage, "pay_1")?.body.items[0].mark_codes).toEqual(["actual\u001dcode"]);
  });

  it("does not allocate a new mutation key when a second submit races or form data changes", () => {
    const storage = memoryStorage();
    retainFiscalAttempt(storage, attempt);
    const changed: FiscalAttempt = { ...attempt, body: { ...attempt.body, idempotency_key: "unsafe_new_key", items: [{ line_index: 1, quantity: 2 }] } };
    expect(retainFiscalAttempt(storage, changed)).toEqual(attempt);
    expect(readFiscalAttempt(storage, "pay_1")).toEqual(attempt);
  });

  it("separates attempts by actual native payment ID", () => {
    const storage = memoryStorage();
    retainFiscalAttempt(storage, attempt);
    expect(readFiscalAttempt(storage, "pay_other")).toBeNull();
    expect(readFiscalAttempt(storage, "pay_1")).toEqual(attempt);
  });

  it("only removes an attempt on explicit acknowledgement", () => {
    const storage = memoryStorage();
    retainFiscalAttempt(storage, attempt);
    const rejected = rejectFiscalAttempt(storage, attempt);
    expect(rejected.body).toEqual(attempt.body);
    expect(readFiscalAttempt(storage, "pay_1")?.definitively_rejected).toBe(true);
    clearFiscalAttempt(storage, "pay_1");
    expect(readFiscalAttempt(storage, "pay_1")).toBeNull();
  });

  it.each(["prepared", "submitting", "indeterminate"])("keeps %s blocked against a new refund", (state) => {
    expect(isFiscalOperationSettled({ state, fiscal_state: "pending" } as RefundOperationSummary)).toBe(false);
  });

  it.each(["pending", "failed"])("does not treat money success with fiscal %s as fiscalized", (fiscal_state) => {
    expect(isFiscalOperationSettled({ state: "succeeded", fiscal_state } as RefundOperationSummary)).toBe(false);
  });

  it("waits for native accounting as well as money and fiscal success", () => {
    const operation: RefundOperationSummary = {
      id: "tbref_one", kind: "refund", idempotency_key: "one", amount_kopecks: 100,
      state: "succeeded", fiscal_state: "succeeded", native_refund_id: "ref_one",
      error_code: null, created_at: "2026-11-16T00:00:00Z",
    };
    expect(isFiscalOperationSettled(operation)).toBe(true);
    expect(isFiscalOperationSettled({ ...operation, native_refund_id: null })).toBe(false);
    expect(isFiscalOperationSettled({ ...operation, kind: "closing", native_refund_id: null })).toBe(true);
    expect(isFiscalOperationSettled({ ...operation, state: "rejected", fiscal_state: "pending", native_refund_id: null })).toBe(true);
  });

  it.each([undefined, new Error("network timeout"), { status: 408 }, { status: 409 }, { status: 425 }, { status: 429 }, { status: 500 }])("does not release an unknown mutation on transport failure", (error) => {
    expect(isDefinitiveRequestRejection(error)).toBe(false);
  });

  it.each([400, 401, 403, 404, 422])("recognizes definitive HTTP %s request rejection", (status) => {
    expect(isDefinitiveRequestRejection({ status })).toBe(true);
  });

  it("fails closed on malformed saved attempts rather than silently issuing a fresh refund", () => {
    const storage = memoryStorage();
    storage.setItem("tbank-fiscal-attempt:pay_1", "{broken");
    expect(() => readFiscalAttempt(storage, "pay_1")).toThrow();
  });
});
