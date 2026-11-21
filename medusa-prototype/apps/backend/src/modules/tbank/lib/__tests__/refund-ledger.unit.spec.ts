import type { TBankReceipt } from "../receipt";
import { blocksNextOperation, digest, planOperation, remainingSelections, type OperationRow, type PrepareOperation } from "../refund-ledger";

const markA = "010460123456789321UNIT-A\u001d93ABCD";
const markB = "010460123456789321UNIT-B\u001d93ABCD";
const markC = "010460123456789321UNIT-C\u001d93ABCD";
const original: TBankReceipt = {
  Email: "refund@example.test", Taxation: "usn_income",
  Items: [
    { Name: "Платье", Price: 334, Quantity: 1, Amount: 334, Tax: "vat105", PaymentMethod: "full_prepayment", PaymentObject: "commodity", MeasurementUnit: "шт" },
    { Name: "Платье", Price: 333, Quantity: 2, Amount: 666, Tax: "vat105", PaymentMethod: "full_prepayment", PaymentObject: "commodity", MeasurementUnit: "шт" },
    { Name: "Доставка", Price: 200, Quantity: 1, Amount: 200, Tax: "vat105", PaymentMethod: "full_prepayment", PaymentObject: "service", MeasurementUnit: "шт" },
  ],
};
const input: PrepareOperation = {
  kind: "refund", payment_id: "pay_test", payment_session_id: "payses_test", bank_payment_id: "123",
  terminal_key: "terminal", idempotency_key: "refund-one", snapshot_hash: digest(original), original,
  selections: [{ line_index: 1, quantity: 1 }], receipt_mode: "prepayment", operator_id: "usr_test", credit_amount_kopecks: 333,
};
function operation(overrides: Partial<OperationRow> = {}): OperationRow {
  return { ...planOperation(input, []), created_at: new Date("2026-11-16T00:00:00Z"), ...overrides };
}

describe("frozen fiscal refund reservations", () => {
  it("reserves exact discounted receipt rows rather than matching duplicate names", () => {
    const row = operation({ state: "indeterminate" });
    expect(row.amount_kopecks).toBe(333);
    expect(remainingSelections(original, [row])).toEqual([
      { line_index: 0, quantity: 1 }, { line_index: 1, quantity: 1 }, { line_index: 2, quantity: 1 },
    ]);
    expect(() => planOperation({ ...input, idempotency_key: "second", selections: [{ line_index: 1, quantity: 2 }] }, [row])).toThrow();
  });

  it("reuses an uncertain operation without recomputing its frozen credit amount", () => {
    const row = operation({ state: "indeterminate" });
    expect(planOperation({ ...input, credit_amount_kopecks: 0 }, [row])).toBe(row);
    expect(planOperation(input, [row]).external_request_id).toBe(row.external_request_id);
    expect(() => planOperation({ ...input, selections: [{ line_index: 0, quantity: 1 }] }, [row])).toThrow();
  });

  it("does not free a bank-accepted return before both Medusa and the cashbox complete", () => {
    const row = operation({ state: "succeeded" });
    expect(blocksNextOperation(row)).toBe(true);
    expect(blocksNextOperation({ ...row, fiscal_state: "succeeded" })).toBe(true);
    const settled = { ...row, fiscal_state: "succeeded" as const, native_refund_id: "ref_test" };
    const next = planOperation({ ...input, idempotency_key: "second" }, [settled]);
    expect(next.balance_before_kopecks).toBe(867);
    expect(next.amount_kopecks).toBe(333);
    expect(() => planOperation({ ...input, idempotency_key: "third", selections: [{ line_index: 1, quantity: 2 }] }, [settled])).toThrow();
  });

  it("releases quantities only after a definite bank rejection", () => {
    const rejected = operation({ state: "rejected" });
    expect(remainingSelections(original, [rejected])[1].quantity).toBe(2);
    expect(planOperation({ ...input, idempotency_key: "corrected" }, [rejected]).balance_before_kopecks).toBe(1200);
  });

  it("requires the initial fiscal proof and every remaining position for closing", () => {
    const closing: PrepareOperation = { ...input, kind: "closing", receipt_mode: "full_payment", selections: [
      { line_index: 0, quantity: 1, mark_codes: [markA] },
      { line_index: 1, quantity: 2, mark_codes: [markB, markC] },
      { line_index: 2, quantity: 1 },
    ] };
    expect(() => planOperation(closing, [])).toThrow();
    const proof = operation({ id: "proof", idempotency_key: "initial", kind: "prepayment", state: "succeeded", fiscal_state: "succeeded", selections: [] });
    expect(planOperation(closing, [proof]).amount_kopecks).toBe(1200);
    expect(() => planOperation({ ...closing, selections: closing.selections.slice(0, 2) }, [proof])).toThrow();
  });

  it("rejects foreign or previously returned marking codes after closing", () => {
    const closing = operation({ id: "closing", idempotency_key: "closing", kind: "closing", state: "succeeded", fiscal_state: "succeeded", receipt_mode: "full_payment", selections: [
      { line_index: 0, quantity: 1, mark_codes: [markA] },
      { line_index: 1, quantity: 2, mark_codes: [markB, markC] },
      { line_index: 2, quantity: 1 },
    ] });
    expect(() => planOperation({ ...input, receipt_mode: "full_payment", selections: [{ line_index: 1, quantity: 1, mark_codes: [markA] }] }, [closing])).toThrow();
    const returned = operation({ state: "succeeded", fiscal_state: "succeeded", native_refund_id: "ref_one", receipt_mode: "full_payment", selections: [{ line_index: 1, quantity: 1, mark_codes: [markB] }] });
    expect(remainingSelections(original, [closing, returned])[1]).toEqual({ line_index: 1, quantity: 1, mark_codes: [markC] });
    expect(() => planOperation({ ...input, idempotency_key: "second", receipt_mode: "full_payment", selections: [{ line_index: 1, quantity: 1, mark_codes: [markB] }] }, [closing, returned])).toThrow();
  });
});
