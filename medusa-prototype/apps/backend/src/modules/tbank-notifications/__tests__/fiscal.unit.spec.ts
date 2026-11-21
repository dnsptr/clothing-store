import {
  canonicalFiscalReceiptHash,
  parseAuthenticatedFiscalReceipt,
  persistFiscalReceipt,
} from "../fiscal";
import type { FiscalReceiptRow } from "../fiscal";

const payload = {
  TerminalKey: "test-terminal", OrderId: "payses_1", PaymentId: 123,
  Status: "RECEIPT", Success: true, ErrorCode: "0", Amount: 100,
  Type: "unmapped-bank-type", FnNumber: "9999078900000001",
  FiscalDocumentNumber: 10, FiscalDocumentAttribute: 12345,
};

describe("signed fiscal inbox facts", () => {
  it("leaves unknown calculation types deferred rather than guessing an operation", () => {
    const receipt = parseAuthenticatedFiscalReceipt(payload);
    expect(receipt.receipt_type).toBe("unmapped-bank-type");
    expect(receipt.lifecycle_state).toBe("awaiting_correlation");
    expect(receipt).not.toHaveProperty("operation_id");
  });

  it("normalizes number/string bank scalars and ignores unsigned Receipt", () => {
    expect(canonicalFiscalReceiptHash(payload)).toBe(canonicalFiscalReceiptHash({
      ...payload, PaymentId: "123", Amount: "100", FiscalDocumentNumber: "10",
      Receipt: { Items: [{ PaymentMethod: "full_payment" }] }, Token: "not-stored",
    }));
  });

  it("does not mistake a nonzero ErrorCode for fiscal success", () => {
    const receipt = parseAuthenticatedFiscalReceipt({
      ...payload, ErrorCode: "500", FnNumber: undefined,
      FiscalDocumentNumber: undefined, FiscalDocumentAttribute: undefined,
    });
    expect(receipt.success).toBe(false);
    expect(receipt.error_code).toBe("500");
    expect(receipt.fn_number).toBeNull();
  });

  it.each([0, "0", null, undefined])("rejects missing/zero successful fiscal document attribute %s", (attribute) => {
    expect(() => parseAuthenticatedFiscalReceipt({ ...payload, FiscalDocumentAttribute: attribute })).toThrow();
  });

  it("recovers a unique-insert race as one durable fact", async () => {
    const incoming = parseAuthenticatedFiscalReceipt(payload);
    const canonical: FiscalReceiptRow = { id: "tbfiscal_1", ...incoming };
    const store = {
      listTbankFiscalReceipts: jest.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([canonical]),
      createTbankFiscalReceipts: jest.fn().mockRejectedValue(new Error("unique violation")),
      quarantineFiscalReceipt: jest.fn(),
    };
    await expect(persistFiscalReceipt(store, incoming)).resolves.toEqual({ id: canonical.id, conflict: false });
  });

  it("quarantines a conflicting insert race instead of acknowledging it as identical", async () => {
    const incoming = parseAuthenticatedFiscalReceipt(payload);
    const canonical: FiscalReceiptRow = { id: "tbfiscal_1", ...incoming, canonical_payload_hash: "different" };
    const store = {
      listTbankFiscalReceipts: jest.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([canonical]),
      createTbankFiscalReceipts: jest.fn().mockRejectedValue(new Error("unique violation")),
      quarantineFiscalReceipt: jest.fn(),
    };
    await expect(persistFiscalReceipt(store, incoming)).resolves.toEqual({ id: canonical.id, conflict: true });
  });

  it("does not reactivate a quarantined canonical payload on replay", async () => {
    const incoming = parseAuthenticatedFiscalReceipt(payload);
    const canonical: FiscalReceiptRow = { id: "tbfiscal_1", ...incoming, lifecycle_state: "manual_review" };
    const store = {
      listTbankFiscalReceipts: jest.fn().mockResolvedValue([canonical]),
      createTbankFiscalReceipts: jest.fn(), quarantineFiscalReceipt: jest.fn(),
    };
    await expect(persistFiscalReceipt(store, incoming)).resolves.toEqual({ id: canonical.id, conflict: true });
  });
});
