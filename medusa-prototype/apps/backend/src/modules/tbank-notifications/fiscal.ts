import { createHash } from "crypto";
import type { PaymentSessionDTO } from "@medusajs/types";

import { rublesToKopecks } from "../tbank/lib/money";
import { isTBankStatus } from "../tbank/lib/status";
import { tokenValueToString } from "../tbank/lib/token";
import { TBANK_PAYMENT_PROVIDER_ID } from "../tbank/provider-id";

// ErrorMessage and Url alone are ambiguous with payment callbacks on this shared endpoint.
const FISCAL_MARKERS = [
  "Type", "FiscalNumber", "ShiftNumber", "ReceiptDatetime",
  "FnNumber", "EcrRegNumber", "FiscalDocumentNumber", "FiscalDocumentAttribute",
  "Ofd", "QrCodeUrl", "CalculationPlace", "CashierName", "SettlePlace",
] as const;
const MAX_IDENTIFIER = 128;
const MAX_ERROR = 1000;
function hasSignedFiscalMarker(body: Readonly<Record<string, unknown>>): boolean {
  return FISCAL_MARKERS.some((key) => {
    const value = body[key];
    return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
  });
}
export function requiresFiscalAudit(body: Readonly<Record<string, unknown>>): boolean {
  return hasSignedFiscalMarker(body) || !isTBankStatus(body["Status"]);
}

export function fiscalFingerprint(body: Readonly<Record<string, unknown>>): string {
  const scalars = Object.entries(body)
    .filter(([key, value]) => key !== "Token" && key !== "Password" &&
      (typeof value === "string" || typeof value === "number" || typeof value === "boolean"))
    .map(([key, value]) => [key, tokenValueToString(value as string | number | boolean)])
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
  return createHash("sha256").update(JSON.stringify(scalars), "utf8").digest("hex");
}

function identifier(value: unknown): string | null {
  const text = typeof value === "string" || (typeof value === "number" && Number.isSafeInteger(value))
    ? String(value) : null;
  return text && text.length <= MAX_IDENTIFIER && /^[a-zA-Z0-9_-]+$/.test(text) ? text : null;
}

function opaque(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_IDENTIFIER &&
    /^[a-zA-Z0-9_-]+$/.test(value) ? value : null;
}

function kopecks(value: unknown): number | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (typeof value === "string" && !/^\d+$/.test(value)) return null;
  const amount = Number(value);
  return Number.isSafeInteger(amount) && amount >= 0 ? amount : null;
}

function safeErrorMessage(value: unknown): string | null {
  if (typeof value !== "string") return null;
  // Best-effort removal of common customer details from signed bank diagnostics.
  return value.replace(/[\w.+-]+@[\w.-]+\.[a-zA-Z]{2,}/g, "[redacted email]")
    .replace(/\b(?:\d[ -]?){10,19}\b/g, "[redacted number]")
    .slice(0, MAX_ERROR);
}

export type FiscalJournal = {
  listTbankFiscalNotifications(filters: { fingerprint: string }): Promise<readonly { fingerprint: string }[]>;
  createTbankFiscalNotifications(input: Readonly<Record<string, unknown>>): Promise<unknown>;
};

type PaymentReader = { retrievePaymentSession(id: string): Promise<PaymentSessionDTO> };

function correlationFailures(
  session: PaymentSessionDTO,
  expectedTerminal: string,
  terminal: string | null,
  order: string,
  payment: string,
  amount: number | null,
): string[] {
  const failures: string[] = [];
  if (terminal !== expectedTerminal) failures.push("terminal_mismatch");
  if (session.provider_id !== TBANK_PAYMENT_PROVIDER_ID) failures.push("provider_mismatch");
  if (order !== session.id || order !== session.data?.["orderId"]) failures.push("order_mismatch");
  if (payment !== session.data?.["paymentId"]) failures.push("payment_mismatch");
  if (session.currency_code?.toLowerCase() !== "rub") failures.push("currency_mismatch");
  if (session.status !== "captured") failures.push("payment_not_captured");
  if (amount !== null) {
    try {
      if (rublesToKopecks(session.amount) !== amount) failures.push("amount_mismatch");
    } catch {
      failures.push("amount_mismatch");
    }
  }
  return failures;
}

/** Journal the signed scalar evidence; the nested Receipt is intentionally neither parsed nor persisted. */
export async function auditFiscalNotification(
  body: Readonly<Record<string, unknown>>,
  terminalKey: string,
  journal: FiscalJournal,
  paymentReader: PaymentReader,
): Promise<void> {
  const fingerprint = fiscalFingerprint(body);
  if ((await journal.listTbankFiscalNotifications({ fingerprint })).some((row) => row.fingerprint === fingerprint)) return;

  const terminal = identifier(body["TerminalKey"]);
  const order = identifier(body["OrderId"]);
  const payment = identifier(body["PaymentId"]);
  const amount = kopecks(body["Amount"]);
  const status = opaque(body["Status"]);
  const errorCode = opaque(body["ErrorCode"]) ??
    (typeof body["ErrorCode"] === "number" && Number.isSafeInteger(body["ErrorCode"])
      ? String(body["ErrorCode"]) : null);
  const success = typeof body["Success"] === "boolean" ? body["Success"] : null;
  const reasons: string[] = [];
  if (!terminal) reasons.push("missing_terminal");
  if (!order) reasons.push("missing_order");
  if (!payment) reasons.push("missing_payment");
  if (!status) reasons.push("missing_status");
  if (status && status !== "CONFIRMED") reasons.push("status_unconfirmed");
  if (amount === null) reasons.push(body["Amount"] == null ? "missing_amount" : "invalid_amount");
  if (errorCode === null) reasons.push("missing_error_code");
  else if (errorCode !== "0") reasons.push("fiscal_error");
  if (success !== true) reasons.push(success === false ? "fiscal_failure" : "missing_success");
  if (typeof body["ErrorMessage"] === "string" && body["ErrorMessage"].trim()) {
    reasons.push("fiscal_error_message");
  }
  // An unrecognized payment status alone is not evidence of fiscal success.
  if (!hasSignedFiscalMarker(body)) {
    reasons.push("ambiguous_notification_type");
  }
  if (order && payment) {
    try {
      const session = await paymentReader.retrievePaymentSession(order);
      reasons.push(...correlationFailures(session, terminalKey, terminal, order, payment, amount));
    } catch {
      reasons.push("session_unavailable");
    }
  }

  try {
    await journal.createTbankFiscalNotifications({
      fingerprint,
      terminal_key: terminal ?? terminalKey,
      payment_id: payment,
      order_id: order,
      status,
      receipt_type: opaque(body["Type"]),
      success,
      amount_kopecks: amount,
      error_code: errorCode,
      error_message: safeErrorMessage(body["ErrorMessage"]),
      fn_number: identifier(body["FnNumber"]),
      fiscal_document_number: identifier(body["FiscalDocumentNumber"]),
      review_state: reasons.length > 0 ? "manual_review" : "observed",
      review_reason: reasons.length > 0 ? reasons.join(",") : null,
    });
  } catch (error) {
    // Only a unique-key race can turn a failed insert into a successful acknowledgement.
    const candidate = error as { code?: string; driverError?: { code?: string } };
    const code = candidate?.code ?? candidate?.driverError?.code;
    if (code !== "23505") throw error;
    const canonical = await journal.listTbankFiscalNotifications({ fingerprint });
    if (!canonical.some((row) => row.fingerprint === fingerprint)) throw error;
  }
}
