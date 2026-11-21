import { createHash } from "crypto";

/**
 * https://developer.tbank.ru/eacq/intro/developer/notification
 * Only top-level scalars are covered by T-Bank's token; Receipt is NOT trusted.
 * A coordinator must lock this row and its operation in one database transaction,
 * correlate terminal/payment/order/type/amount without unsigned Receipt fields,
 * then update fiscal_state and set operation_id/processed_at/lifecycle_state.
 * Missing or ambiguous matches stay awaiting_correlation for durable reconciliation.
 */
export type FiscalReceiptRow = {
  readonly id: string;
  readonly terminal_key: string;
  readonly payment_id: string;
  readonly order_id: string;
  readonly receipt_key: string;
  readonly receipt_type: string;
  readonly amount_kopecks: number;
  readonly success: boolean;
  readonly error_code: string;
  readonly fn_number: string | null;
  readonly fiscal_document_number: string | null;
  readonly fiscal_document_attribute: string | null;
  readonly receipt_datetime: string | null;
  readonly fiscal_number: string | null;
  readonly shift_number: string | null;
  readonly ecr_reg_number: string | null;
  readonly canonical_payload_hash: string;
  readonly lifecycle_state: "awaiting_correlation" | "processed" | "manual_review";
  readonly operation_id?: string | null;
  readonly correlation_kind?: "prepayment" | "refund" | "closing" | null;
  readonly processed_at?: Date | string | null;
  readonly created_at?: Date | string;
};

export type AuthenticatedFiscalReceipt = Omit<FiscalReceiptRow, "id" | "operation_id" | "correlation_kind" | "processed_at" | "created_at">;
export type PersistedFiscalReceipt = { readonly id: string; readonly conflict: boolean };

export interface TbankFiscalReceiptStore {
  listTbankFiscalReceipts(filters: Readonly<Record<string, unknown>>): Promise<readonly FiscalReceiptRow[]>;
  createTbankFiscalReceipts(input: AuthenticatedFiscalReceipt): Promise<FiscalReceiptRow | readonly FiscalReceiptRow[]>;
  quarantineFiscalReceipt(input: FiscalReceiptConflict): Promise<void>;
}

export type FiscalReceiptConflict = {
  readonly id: string;
  readonly terminal_key: string;
  readonly payment_id: string;
  readonly canonical_payload_hash: string;
  readonly conflicting_payload_hash: string;
};

function identifier(value: unknown, field: string): string {
  if (typeof value === "string" && value.trim().length > 0) return value;
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return String(value);
  throw new Error(`T-Bank fiscal notification: invalid ${field}`);
}

function optionalIdentifier(value: unknown, field: string): string | null {
  return value === null || value === undefined || value === "" ? null : identifier(value, field);
}

export function canonicalFiscalReceiptHash(payload: Readonly<Record<string, unknown>>): string {
  const scalars = Object.entries(payload)
    .filter(([key, value]) => key !== "Token" && key !== "Password" &&
      (typeof value === "string" || typeof value === "number" || typeof value === "boolean"))
    .map(([key, value]) => [key, String(value)] as const)
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
  return createHash("sha256").update(JSON.stringify(scalars)).digest("hex");
}

/** Call only AFTER verifying the token and checking the configured terminal. */
export function parseAuthenticatedFiscalReceipt(payload: Readonly<Record<string, unknown>>): AuthenticatedFiscalReceipt {
  if (payload.Status !== "RECEIPT" || typeof payload.Success !== "boolean") {
    throw new Error("T-Bank fiscal notification: invalid status/success");
  }
  const terminal_key = identifier(payload.TerminalKey, "TerminalKey");
  const payment_id = identifier(payload.PaymentId, "PaymentId");
  const order_id = identifier(payload.OrderId, "OrderId");
  const receipt_type = identifier(payload.Type, "Type");
  const error_code = identifier(payload.ErrorCode, "ErrorCode");
  const amount = payload.Amount;
  const amount_kopecks = typeof amount === "number" ? amount :
    typeof amount === "string" && /^\d+$/.test(amount) ? Number(amount) : NaN;
  if (!Number.isSafeInteger(amount_kopecks) || amount_kopecks < 0) {
    throw new Error("T-Bank fiscal notification: invalid Amount");
  }
  const fn_number = optionalIdentifier(payload.FnNumber, "FnNumber");
  const fiscal_document_number = optionalIdentifier(payload.FiscalDocumentNumber, "FiscalDocumentNumber");
  const fiscal_document_attribute = optionalIdentifier(payload.FiscalDocumentAttribute, "FiscalDocumentAttribute");
  const receipt_datetime = optionalIdentifier(payload.ReceiptDatetime, "ReceiptDatetime");
  const fiscal_number = optionalIdentifier(payload.FiscalNumber, "FiscalNumber");
  const shift_number = optionalIdentifier(payload.ShiftNumber, "ShiftNumber");
  const ecr_reg_number = optionalIdentifier(payload.EcrRegNumber, "EcrRegNumber");
  const success = payload.Success && error_code === "0";
  if (success && (!fn_number || !fiscal_document_number || fiscal_document_number === "0" || !fiscal_document_attribute || fiscal_document_attribute === "0")) {
    throw new Error("T-Bank fiscal notification: missing successful fiscal document identity");
  }
  // PaymentId+RECEIPT is not unique: initial, closing, and multiple refunds coexist.
  // Failed attempts may have no fiscal document; they remain uncorrelated when ambiguous.
  const identity = fn_number && fiscal_document_number && fiscal_document_number !== "0"
    ? [terminal_key, payment_id, fn_number, fiscal_document_number]
    : [terminal_key, payment_id, receipt_type, amount_kopecks, error_code];
  const receipt_key = createHash("sha256").update(JSON.stringify(identity)).digest("hex");
  return {
    terminal_key, payment_id, order_id, receipt_key, receipt_type, amount_kopecks, success, error_code,
    fn_number, fiscal_document_number, fiscal_document_attribute, receipt_datetime,
    fiscal_number, shift_number, ecr_reg_number,
    canonical_payload_hash: canonicalFiscalReceiptHash(payload), lifecycle_state: "awaiting_correlation",
  };
}

/** Durably journal before ACK. Does not run financial or fiscal side effects. */
export async function persistFiscalReceipt(
  store: TbankFiscalReceiptStore,
  incoming: AuthenticatedFiscalReceipt,
): Promise<PersistedFiscalReceipt> {
  const key = { receipt_key: incoming.receipt_key };
  let canonical = (await store.listTbankFiscalReceipts(key))[0];
  if (!canonical) {
    try {
      const created = await store.createTbankFiscalReceipts(incoming);
      canonical = Array.isArray(created) ? created[0] : created as FiscalReceiptRow;
      if (!canonical?.id) throw new Error("T-Bank fiscal inbox did not return an id");
    } catch (error) {
      canonical = (await store.listTbankFiscalReceipts(key))[0];
      if (!canonical) throw error;
    }
  }
  const conflict = canonical.canonical_payload_hash !== incoming.canonical_payload_hash;
  if (conflict) {
    await store.quarantineFiscalReceipt({
      id: canonical.id, terminal_key: incoming.terminal_key, payment_id: incoming.payment_id,
      canonical_payload_hash: canonical.canonical_payload_hash,
      conflicting_payload_hash: incoming.canonical_payload_hash,
    });
  }
  return { id: canonical.id, conflict: conflict || canonical.lifecycle_state === "manual_review" };
}
