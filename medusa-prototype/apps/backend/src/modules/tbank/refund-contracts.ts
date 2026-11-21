export type RefundReceiptMode = "prepayment" | "full_payment";

export type RefundSelection = {
  readonly line_index: number;
  readonly quantity: number;
  readonly mark_codes?: readonly string[];
};

export type RefundRequest = {
  readonly payment_id: string;
  readonly idempotency_key: string;
  readonly items: readonly RefundSelection[];
  readonly receipt_mode: RefundReceiptMode;
  readonly note?: string;
  readonly refund_reason_id?: string;
  readonly operator_id: string;
};

export type RefundPreviewLine = {
  readonly line_index: number;
  readonly name: string;
  readonly price_kopecks: number;
  readonly quantity: number;
  readonly available_quantity: number;
  readonly available_mark_codes?: readonly string[];
  readonly payment_object: "commodity" | "service";
};

export type RefundOperationSummary = {
  readonly kind: "refund" | "closing";
  readonly id: string;
  readonly idempotency_key: string;
  readonly amount_kopecks: number;
  readonly state: "prepared" | "submitting" | "succeeded" | "rejected" | "indeterminate";
  readonly fiscal_state: "pending" | "succeeded" | "failed";
  readonly native_refund_id: string | null;
  readonly error_code: string | null;
  readonly created_at: string;
};

export type RefundPreview = {
  readonly payment_id: string;
  readonly order_id: string | null;
  readonly currency_code: "rub";
  readonly paid_amount_kopecks: number;
  readonly receipt_mode: RefundReceiptMode;
  readonly closing_available: boolean;
  readonly closing_unavailable_reason?: string;
  readonly refundable_amount_kopecks: number;
  readonly lines: readonly RefundPreviewLine[];
  readonly operations: readonly RefundOperationSummary[];
};

export type RefundResult = {
  readonly operation: RefundOperationSummary;
  readonly payment_id: string;
};


export type ClosingReceiptRequest = {
  readonly payment_id: string;
  readonly idempotency_key: string;
  readonly items: readonly RefundSelection[];
  readonly operator_id: string;
};