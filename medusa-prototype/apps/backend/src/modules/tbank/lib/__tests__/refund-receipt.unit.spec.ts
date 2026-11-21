import type { RefundSelection } from "../../refund-contracts";
import type { TBankReceipt } from "../receipt";
import { buildClosingReceipt, buildRefundReceipt, RefundReceiptBuildError } from "../refund-receipt";

// Synthetic scanner-shaped values are test fixtures, never production fallbacks.
const MARK_A = `010460123456789321TEST-UNIT-A\u001d91ABCD\u001d92${"A".repeat(43)}=`;
const MARK_B = `010460123456789321TEST-UNIT-B\u001d91ABCD\u001d92${"B".repeat(43)}=`;
const original: TBankReceipt = {
  Email: "buyer@example.com",
  Phone: "+79991234567",
  Taxation: "usn_income",
  Items: [
    { Name: "Платье / M", Price: 334, Quantity: 1, Amount: 334, Tax: "vat105", PaymentMethod: "full_prepayment", PaymentObject: "commodity", MeasurementUnit: "шт" },
    { Name: "Платье / M", Price: 333, Quantity: 2, Amount: 666, Tax: "vat105", PaymentMethod: "full_prepayment", PaymentObject: "commodity", MeasurementUnit: "шт" },
    { Name: "Доставка", Price: 200, Quantity: 1, Amount: 200, Tax: "vat105", PaymentMethod: "full_prepayment", PaymentObject: "service", MeasurementUnit: "шт" },
  ],
};

describe("frozen refund/closing receipt builders", () => {
  it("retains exact initial split-rounding row prices for partial quantities", () => {
    const receipt = buildRefundReceipt(original, [{ line_index: 1, quantity: 1 }], "prepayment");
    expect(receipt).toEqual({
      Email: original.Email, Phone: original.Phone, Taxation: original.Taxation,
      Items: [{ ...original.Items[1], Quantity: 1, Amount: 333 }],
    });
    expect(buildRefundReceipt(original, [{ line_index: 0, quantity: 1 }, { line_index: 1, quantity: 2 }], "prepayment")
      .Items.reduce((sum, item) => sum + item.Amount, 0)).toBe(1000);
    expect(original.Items[1].Quantity).toBe(2);
  });

  it("preserves copied contacts and fiscal names rather than repricing products", () => {
    const source = JSON.parse(JSON.stringify(original)) as TBankReceipt;
    const receipt = buildRefundReceipt(source, [{ line_index: 1, quantity: 2 }], "prepayment");
    expect(receipt.Items[0]).not.toBe(source.Items[1]);
    expect(receipt.Items[0]).toEqual(source.Items[1]);
    expect(receipt.Payments).toBeUndefined();
  });

  it("preserves AIM scanner prefixes and short clothing codes without inventing data", () => {
    const code = `]d2${MARK_A.slice(0, MARK_A.indexOf("\u001d"))}\u001d93ABCD`;
    const receipt = buildClosingReceipt(original, [{ line_index: 0, quantity: 1, mark_codes: [code] }]);
    expect(receipt.Items[0].MarkCode).toEqual({ MarkCodeType: "RAWCODE", Value: code });
  });

  it("emits one marked full-payment/vat5 position per physical unit", () => {
    const receipt = buildRefundReceipt(original, [{ line_index: 1, quantity: 2, mark_codes: [MARK_A, MARK_B] }], "full_payment");
    expect(receipt.Items).toEqual([MARK_A, MARK_B].map((Value) => ({
      ...original.Items[1], Quantity: 1, Amount: 333, Tax: "vat5", PaymentMethod: "full_payment",
      PaymentObject: "goods_with_marking_code", MarkProcessingMode: "0", MarkCode: { MarkCodeType: "RAWCODE", Value },
    })));
  });

  it("closes prepaid amounts without collecting electronic payment again", () => {
    const receipt = buildClosingReceipt(original, [
      { line_index: 1, quantity: 2, mark_codes: [MARK_A, MARK_B] },
      { line_index: 2, quantity: 1 },
    ]);
    expect(receipt.Payments).toEqual({ Electronic: 0, AdvancePayment: 866 });
    expect(receipt.Items[2]).toEqual({ ...original.Items[2], Tax: "vat5", PaymentMethod: "full_payment" });
    expect(receipt.Items[2].MarkCode).toBeUndefined();
  });

  it.each<{ items: readonly RefundSelection[] }>([
    { items: [] },
    { items: [{ line_index: -1, quantity: 1 }] },
    { items: [{ line_index: 0.5, quantity: 1 }] },
    { items: [{ line_index: 9, quantity: 1 }] },
    { items: [{ line_index: 1, quantity: 1 }, { line_index: 1, quantity: 1 }] },
    { items: [{ line_index: 1, quantity: 0 }] },
    { items: [{ line_index: 1, quantity: -1 }] },
    { items: [{ line_index: 1, quantity: 1.5 }] },
    { items: [{ line_index: 1, quantity: 3 }] },
    { items: [{ line_index: 1, quantity: Number.MAX_SAFE_INTEGER + 1 }] },
  ])("rejects invalid/duplicate selections %#", ({ items }) => {
    expect(() => buildRefundReceipt(original, items, "prepayment")).toThrow(RefundReceiptBuildError);
  });
  it.each<{ codes: readonly string[] | undefined }>([
    { codes: undefined },
    { codes: [] },
    { codes: [MARK_A] },
    { codes: [MARK_A, MARK_A] },
    { codes: [MARK_A, "not-a-DataMatrix"] },
    { codes: [MARK_A, MARK_B.replace(/\u001d/g, "\\u001d")] },
    { codes: [MARK_A, MARK_B.replace("04601234567893", "04601234567894")] },
    { codes: [MARK_A, `${MARK_B}${"X".repeat(201)}`] },
    { codes: [MARK_A, MARK_B.replace(/92.*$/, "92incomplete")] },
    { codes: [MARK_A, `]d2${MARK_A}`] },
    { codes: [MARK_A, MARK_A.replace("91ABCD", "91EFGH")] },
  ])("rejects missing, duplicate, corrupt, display-escaped or oversized marks %#", ({ codes }) => {
    expect(() => buildRefundReceipt(original, [{ line_index: 1, quantity: 2, mark_codes: codes }], "full_payment"))
      .toThrow(RefundReceiptBuildError);
  });

  it("rejects marking data on prepayments or service rows instead of silently discarding it", () => {
    expect(() => buildRefundReceipt(original, [{ line_index: 0, quantity: 1, mark_codes: [MARK_A] }], "prepayment")).toThrow(RefundReceiptBuildError);
    expect(() => buildClosingReceipt(original, [{ line_index: 2, quantity: 1, mark_codes: [MARK_A] }])).toThrow(RefundReceiptBuildError);
  });

  it.each([
    { Amount: 665 },
    { Price: 332 },
    { Quantity: 1.5 },
    { Quantity: 100000 },
    { Name: "X".repeat(129) },
    { Name: "bad\u0000name" },
    { Tax: "vat5" },
    { PaymentMethod: "full_payment" },
  ])("rejects changed/inconsistent or oversized frozen rows %j", (changes) => {
    const source = { ...original, Items: [original.Items[0], { ...original.Items[1], ...changes }, original.Items[2]] } as TBankReceipt;
    expect(() => buildRefundReceipt(source, [{ line_index: 1, quantity: 1 }], "prepayment")).toThrow(RefundReceiptBuildError);
  });

  it("bounds source/selection/output counts and contacts", () => {
    const oversized = { ...original, Items: Array.from({ length: 101 }, () => original.Items[0]) };
    expect(() => buildRefundReceipt(oversized, [{ line_index: 0, quantity: 1 }], "prepayment")).toThrow(RefundReceiptBuildError);
    expect(() => buildRefundReceipt(original, Array.from({ length: 101 }, () => ({ line_index: 0, quantity: 1 })), "prepayment")).toThrow(RefundReceiptBuildError);
    expect(() => buildRefundReceipt({ ...original, Email: `${"a".repeat(65)}@example.com` }, [{ line_index: 0, quantity: 1 }], "prepayment")).toThrow(RefundReceiptBuildError);
    const manyUnits = { ...original, Items: [{ ...original.Items[0], Quantity: 101, Amount: 334 * 101 }] };
    expect(() => buildClosingReceipt(manyUnits, [{ line_index: 0, quantity: 101, mark_codes: Array.from({ length: 101 }, (_, n) => MARK_A.replace("UNIT-A", `UNIT-${n}`)) }])).toThrow(RefundReceiptBuildError);
  });

  it("rejects integer overflow instead of rounding money", () => {
    const source = { ...original, Items: [{ ...original.Items[0], Price: Number.MAX_SAFE_INTEGER, Quantity: 2, Amount: Number.MAX_SAFE_INTEGER * 2 }] };
    expect(() => buildRefundReceipt(source, [{ line_index: 0, quantity: 1 }], "prepayment")).toThrow(RefundReceiptBuildError);
  });
});
