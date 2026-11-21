import type { RefundOperationSummary, RefundReceiptMode, RefundSelection } from "../../modules/tbank/refund-contracts";

export type FiscalAttempt = {
  payment_id: string;
  kind: "refund" | "closing";
  body: {
    idempotency_key: string;
    items: RefundSelection[];
    receipt_mode?: RefundReceiptMode;
    note?: string;
  };
  definitively_rejected?: boolean;
};

type AttemptStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const storageKey = (paymentId: string) => `tbank-fiscal-attempt:${paymentId}`;

export function readFiscalAttempt(storage: AttemptStorage, paymentId: string): FiscalAttempt | null {
  const raw = storage.getItem(storageKey(paymentId));
  if (!raw) return null;
  const value = JSON.parse(raw) as FiscalAttempt;
  if (value.payment_id !== paymentId || !["refund", "closing"].includes(value.kind) ||
    typeof value.body?.idempotency_key !== "string" || !Array.isArray(value.body.items)) {
    throw new Error("Сохранённая попытка повреждена. Не создавайте новый возврат; проверьте историю операций.");
  }
  return value;
}

export function retainFiscalAttempt(storage: AttemptStorage, attempt: FiscalAttempt): FiscalAttempt {
  const existing = readFiscalAttempt(storage, attempt.payment_id);
  if (existing) return existing;
  storage.setItem(storageKey(attempt.payment_id), JSON.stringify(attempt));
  return attempt;
}

export function rejectFiscalAttempt(storage: AttemptStorage, attempt: FiscalAttempt): FiscalAttempt {
  const rejected = { ...attempt, definitively_rejected: true };
  storage.setItem(storageKey(attempt.payment_id), JSON.stringify(rejected));
  return rejected;
}

export function clearFiscalAttempt(storage: AttemptStorage, paymentId: string): void {
  storage.removeItem(storageKey(paymentId));
}

export function isFiscalOperationSettled(operation: RefundOperationSummary): boolean {
  return operation.state === "rejected" ||
    (operation.state === "succeeded" && operation.fiscal_state === "succeeded" && (operation.kind === "closing" || Boolean(operation.native_refund_id)));
}

export function isDefinitiveRequestRejection(error: unknown): boolean {
  const status = typeof error === "object" && error !== null && "status" in error ? error.status : undefined;
  return typeof status === "number" && status >= 400 && status < 500 && ![408, 409, 425, 429].includes(status);
}
