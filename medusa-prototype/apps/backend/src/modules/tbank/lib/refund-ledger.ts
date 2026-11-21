import { createHash } from "crypto";
import { MedusaError } from "@medusajs/framework/utils";
import type { TBankReceipt } from "./receipt";
import { buildClosingReceipt, buildRefundReceipt } from "./refund-receipt";
import type { RefundReceiptMode, RefundSelection } from "../refund-contracts";

export type OperationRow = {
  id: string;
  kind: "prepayment" | "refund" | "closing";
  payment_id: string;
  payment_session_id: string;
  bank_payment_id: string;
  terminal_key: string;
  idempotency_key: string;
  request_hash: string;
  snapshot_hash: string;
  external_request_id: string;
  amount_kopecks: number;
  original_amount_kopecks: number;
  balance_before_kopecks: number;
  selections: readonly RefundSelection[];
  receipt_mode: RefundReceiptMode;
  credit_amount_kopecks: number;
  state: "prepared" | "submitting" | "succeeded" | "rejected" | "indeterminate";
  fiscal_state: "pending" | "succeeded" | "failed";
  fiscal_receipt_id: string | null;
  fiscal_receipt_type: string | null;
  native_refund_id: string | null;
  error_code: string | null;
  operator_id: string;
  note: string | null;
  refund_reason_id: string | null;
  submitted_at: Date | string | null;
  created_at: Date | string;
};
export type PrepareOperation = {
  kind: "refund" | "closing";
  payment_id: string;
  payment_session_id: string;
  bank_payment_id: string;
  terminal_key: string;
  idempotency_key: string;
  snapshot_hash: string;
  original: TBankReceipt;
  selections: readonly RefundSelection[];
  receipt_mode: RefundReceiptMode;
  operator_id: string;
  note?: string;
  refund_reason_id?: string;
  credit_amount_kopecks: number;
};

export function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
export function markIdentity(code: string): string {
  return code.startsWith("]d2") ? code.slice(3) : code;
}
export function canonicalSelections(items: readonly RefundSelection[]): RefundSelection[] {
  return items.map((item) => ({
    line_index: item.line_index,
    quantity: item.quantity,
    ...(item.mark_codes?.length ? { mark_codes: [...item.mark_codes].sort() } : {}),
  })).sort((a, b) => a.line_index - b.line_index);
}
export function closedOperation(rows: readonly OperationRow[]): OperationRow | undefined {
  return rows.find((row) => row.kind === "closing" && row.state === "succeeded" && row.fiscal_state === "succeeded");
}
export function remainingSelections(original: TBankReceipt, rows: readonly OperationRow[]): RefundSelection[] {
  const closing = closedOperation(rows);
  return original.Items.flatMap((item, line_index) => {
    const used = rows.filter((row) => row.kind === "refund" && row.state !== "rejected")
      .flatMap((row) => row.selections.filter((selection) => selection.line_index === line_index));
    const quantity = item.Quantity - used.reduce((sum, selection) => sum + selection.quantity, 0);
    const usedCodes = new Set(used.flatMap((selection) => selection.mark_codes ?? []).map(markIdentity));
    const codes = closing?.selections.find((selection) => selection.line_index === line_index)?.mark_codes
      ?.filter((code) => !usedCodes.has(markIdentity(code)));
    return quantity > 0 ? [{ line_index, quantity, ...(codes?.length ? { mark_codes: codes } : {}) }] : [];
  });
}
export function blocksNextOperation(row: Pick<OperationRow, "kind" | "state" | "fiscal_state" | "native_refund_id">): boolean {
  return row.kind !== "prepayment" && row.state !== "rejected" &&
    (row.state !== "succeeded" || row.fiscal_state !== "succeeded" || (row.kind === "refund" && !row.native_refund_id));
}

export function planOperation(input: PrepareOperation, rows: readonly OperationRow[]): Omit<OperationRow, "created_at"> {
  const selections = canonicalSelections(input.selections);
  const amount = (input.kind === "closing"
    ? buildClosingReceipt(input.original, selections)
    : buildRefundReceipt(input.original, selections, input.receipt_mode)).Items.reduce((sum, item) => sum + item.Amount, 0);
  const originalAmount = input.original.Items.reduce((sum, item) => sum + item.Amount, 0);
  const hash = digest({ kind: input.kind, selections, mode: input.receipt_mode, amount, snapshot: input.snapshot_hash, note: input.note ?? null, reason: input.refund_reason_id ?? null });
  const existing = rows.find((row) => row.idempotency_key === input.idempotency_key);
  if (existing) {
    if (existing.request_hash !== hash) throw new MedusaError(MedusaError.Types.INVALID_DATA, "Ключ операции уже использован с другим составом возврата");
    return existing;
  }
  if (rows.some(blocksNextOperation)) throw new MedusaError(MedusaError.Types.CONFLICT, "Предыдущая денежная или кассовая операция ещё не завершена; повторите её с прежним ключом");
  const closing = closedOperation(rows);
  const expectedMode = closing ? "full_payment" : "prepayment";
  if (input.receipt_mode !== expectedMode && input.kind === "refund") {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "Стадия расчёта не совпадает с сохранённым закрывающим чеком");
  }
  const available = remainingSelections(input.original, rows);
  for (const selection of selections) {
    const line = available.find((item) => item.line_index === selection.line_index);
    if (!line || selection.quantity > line.quantity) throw new MedusaError(MedusaError.Types.INVALID_DATA, "Товар уже возвращён либо зарезервирован другой операцией");
    if (input.kind === "refund" && closing && input.original.Items[selection.line_index].PaymentObject === "commodity") {
      const codes = new Set((line.mark_codes ?? []).map(markIdentity));
      if (selection.mark_codes?.some((code) => !codes.has(markIdentity(code)))) {
        throw new MedusaError(MedusaError.Types.INVALID_DATA, "Код маркировки отсутствует в закрывающем чеке либо уже возвращён");
      }
    }
  }
  if (input.kind === "closing") {
    if (closing || rows.some((row) => row.kind === "closing" && row.state !== "rejected")) {
      throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "Закрывающий чек уже отправлен; повторная отправка запрещена");
    }
    if (!rows.some((row) => row.kind === "prepayment" && row.fiscal_state === "succeeded")) {
      throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "Ещё не получен подтверждённый кассовый чек предоплаты");
    }
    if (available.length !== selections.length || available.some((line) => selections.find((item) => item.line_index === line.line_index)?.quantity !== line.quantity)) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "Закрывающий чек должен включать все оставшиеся позиции заказа");
    }
  }
  const refunded = rows.filter((row) => row.kind === "refund" && row.state === "succeeded")
    .reduce((sum, row) => sum + row.amount_kopecks, 0);
  const balance = originalAmount - refunded;
  if (amount <= 0 || amount > balance) throw new MedusaError(MedusaError.Types.INVALID_DATA, "Сумма превышает невозвращенный остаток платежа");
  const id = `tbref_${digest([input.payment_id, input.idempotency_key]).slice(0, 26)}`;
  return {
    id, kind: input.kind, payment_id: input.payment_id, payment_session_id: input.payment_session_id,
    bank_payment_id: input.bank_payment_id, terminal_key: input.terminal_key,
    idempotency_key: input.idempotency_key, request_hash: hash, snapshot_hash: input.snapshot_hash,
    external_request_id: digest(["cancel", input.terminal_key, input.bank_payment_id, input.idempotency_key]).slice(0, 30),
    amount_kopecks: amount, original_amount_kopecks: originalAmount, balance_before_kopecks: balance,
    selections, receipt_mode: input.kind === "closing" ? "full_payment" : input.receipt_mode,
    credit_amount_kopecks: input.credit_amount_kopecks,
    state: "prepared", fiscal_state: "pending", fiscal_receipt_id: null, fiscal_receipt_type: null,
    native_refund_id: null, error_code: null, operator_id: input.operator_id, note: input.note ?? null, submitted_at: null,
    refund_reason_id: input.refund_reason_id ?? null,
  };
}
