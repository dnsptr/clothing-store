import { TbankClosingReceiptSchema, TbankRefundSchema } from "../validators";

const body = {
  idempotency_key: "7d518114-59fd-4ad9-b974-361d078e5ef0",
  receipt_mode: "prepayment",
  items: [{ line_index: 0, quantity: 1 }],
};

describe("T-Bank fiscal request boundary", () => {
  it("accepts an exact receipt row selection", () => {
    expect(TbankRefundSchema.parse(body)).toEqual(body);
  });

  it.each(["operator_id", "operatorId", "payment_id", "amount", "restock", "delivery_status"])("rejects body-controlled %s", (key) => {
    expect(TbankRefundSchema.safeParse({ ...body, [key]: "spoofed" }).success).toBe(false);
  });

  it.each([0, -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, "1", null])("rejects invalid quantity %s", (quantity) => {
    expect(TbankRefundSchema.safeParse({ ...body, items: [{ line_index: 0, quantity }] }).success).toBe(false);
  });

  it("rejects duplicate receipt rows rather than silently combining them", () => {
    expect(TbankRefundSchema.safeParse({ ...body, items: [body.items[0], body.items[0]] }).success).toBe(false);
  });

  it("rejects unknown nested fields and negative row indexes", () => {
    expect(TbankRefundSchema.safeParse({ ...body, items: [{ ...body.items[0], price: 1 }] }).success).toBe(false);
    expect(TbankRefundSchema.safeParse({ ...body, items: [{ line_index: -1, quantity: 1 }] }).success).toBe(false);
  });

  it("preserves the scanner group separator verbatim", () => {
    const mark = "010123456789012321actual\u001d91actual";
    const parsed = TbankRefundSchema.parse({ ...body, receipt_mode: "full_payment", items: [{ line_index: 0, quantity: 1, mark_codes: [mark] }] });
    expect(parsed.items[0].mark_codes).toEqual([mark]);
  });

  it("rejects reused codes within a row or across rows", () => {
    expect(TbankRefundSchema.safeParse({ ...body, items: [{ line_index: 0, quantity: 2, mark_codes: ["actual", "actual"] }] }).success).toBe(false);
    expect(TbankRefundSchema.safeParse({ ...body, items: [
      { line_index: 0, quantity: 1, mark_codes: ["actual"] },
      { line_index: 1, quantity: 1, mark_codes: ["actual"] },
    ] }).success).toBe(false);
  });

  it("requires exactly one code per marked unit when codes are submitted", () => {
    expect(TbankRefundSchema.safeParse({ ...body, items: [{ line_index: 0, quantity: 2, mark_codes: ["actual"] }] }).success).toBe(false);
  });

  it("requires a nonempty key, selection, and recorded mode", () => {
    expect(TbankRefundSchema.safeParse({ ...body, idempotency_key: "" }).success).toBe(false);
    expect(TbankRefundSchema.safeParse({ ...body, items: [] }).success).toBe(false);
    expect(TbankRefundSchema.safeParse({ ...body, receipt_mode: "delivered" }).success).toBe(false);
  });

  it("closing accepts only a key and scanned selections, not actor, mode or note", () => {
    const closing = { idempotency_key: body.idempotency_key, items: [{ line_index: 0, quantity: 1, mark_codes: ["actual"] }] };
    expect(TbankClosingReceiptSchema.parse(closing)).toEqual(closing);
    for (const field of ["operator_id", "payment_id", "receipt_mode", "note"]) {
      expect(TbankClosingReceiptSchema.safeParse({ ...closing, [field]: "spoofed" }).success).toBe(false);
    }
  });
});
