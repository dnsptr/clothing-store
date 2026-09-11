import { createHash } from "crypto";
import type { PaymentSessionDTO } from "@medusajs/types";

import { rublesToKopecks } from "../tbank/lib/money";
import { isTBankStatus, parseNotification } from "../tbank/lib/status";
import { TBANK_PAYMENT_PROVIDER_ID } from "../tbank/provider-id";

export const INBOX_LIFECYCLE_STATES = [
  "pending",
  "awaiting_correlation",
  "leased",
  "processed",
  "manual_review",
] as const;

export type InboxLifecycleState = (typeof INBOX_LIFECYCLE_STATES)[number];

export const INBOX_LEASE_MS = 60_000;
export const MAX_INBOX_ATTEMPTS = 5;
export const RETRY_BACKOFF_MS = [60_000, 300_000, 1_800_000, 7_200_000, 43_200_000] as const;
const CANONICAL_NOTIFICATION_FIELDS = [
  "TerminalKey",
  "OrderId",
  "Success",
  "Status",
  "PaymentId",
  "ErrorCode",
  "Amount",
  "Message",
] as const;

export type AuthenticatedNotification = {
  readonly terminalKey: string;
  readonly orderId: string;
  readonly paymentId: string;
  readonly status: string;
  readonly amountKopecks: number;
  readonly amountProvided: boolean;
  readonly currencyCode: "rub";
  readonly success: boolean;
};

export type CorrelationResult =
  | { readonly kind: "correlated" }
  | { readonly kind: "mismatch"; readonly fields: readonly string[] };

export type StoredNotification = {
  readonly id: string;
  readonly canonical_payload_hash: string;
};

export interface TbankPaymentAttemptRow {
  readonly id: string;
  readonly payment_session_id: string;
  readonly provider_id: string;
  readonly terminal_key: string;
  readonly order_id: string;
  readonly expected_amount_kopecks: number;
  readonly currency_code: string;
}

export interface TbankNotificationStore {
  listTbankNotifications(filters: Readonly<Record<string, string>>): Promise<readonly StoredNotification[]>;
  createTbankNotifications(input: Readonly<Record<string, unknown>>): Promise<unknown>;
  createTbankNotificationConflicts(input: Readonly<Record<string, unknown>>): Promise<unknown>;
  listTbankPaymentAttempts?(filters: Readonly<Record<string, unknown>>): Promise<readonly TbankPaymentAttemptRow[]>;
  createTbankPaymentAttempts?(input: Readonly<Record<string, unknown>>): Promise<TbankPaymentAttemptRow>;
}

export function canonicalNotificationHash(payload: Readonly<Record<string, unknown>>): string {
  const canonicalScalars: Array<readonly [string, string | number | boolean]> = [];
  for (const key of CANONICAL_NOTIFICATION_FIELDS) {
    const value = payload[key];
    if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") continue;
    canonicalScalars.push([key, key === "PaymentId" || key === "Amount" ? String(value) : value]);
  }
  canonicalScalars.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  return createHash("sha256").update(JSON.stringify(canonicalScalars), "utf8").digest("hex");
}

export function toAuthenticatedNotification(
  payload: Readonly<Record<string, unknown>>,
): AuthenticatedNotification {
  const notification = parseNotification(payload);
  const terminalKey = payload["TerminalKey"];
  if (typeof terminalKey !== "string" || terminalKey.length === 0) {
    throw new Error("TBank notification: missing TerminalKey");
  }
  const amount = payload["Amount"];
  const amountProvided = amount !== undefined && amount !== null && amount !== "";
  return { ...notification, terminalKey, currencyCode: "rub", amountProvided };
}

function hasExpectedSuccess(status: string, success: boolean): boolean {
  if (!isTBankStatus(status)) return false;
  const failed = status === "REJECTED" || status === "DEADLINE_EXPIRED" || status === "CANCELED" || status === "REVERSED";
  return success === !failed;
}

export function correlateNotification(
  notification: AuthenticatedNotification,
  session: PaymentSessionDTO,
  expectedTerminalKey: string,
): CorrelationResult {
  const mismatches: string[] = [];
  const data = session.data ?? {};
  if (notification.terminalKey !== expectedTerminalKey) mismatches.push("terminal");
  if (session.provider_id !== TBANK_PAYMENT_PROVIDER_ID) mismatches.push("provider");
  if (notification.paymentId !== data["paymentId"]) mismatches.push("PaymentId");
  if (notification.orderId !== session.id || notification.orderId !== data["orderId"]) mismatches.push("OrderId");
  const permitsMissingAmount = notification.status === "CANCELED" || notification.status === "REJECTED";
  if (notification.amountProvided || !permitsMissingAmount) {
    try {
      if (notification.amountKopecks !== rublesToKopecks(session.amount)) mismatches.push("amount");
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      mismatches.push("amount");
    }
  }
  if (session.currency_code.toLowerCase() !== notification.currencyCode) mismatches.push("currency");
  if (!hasExpectedSuccess(notification.status, notification.success)) mismatches.push("Success/status");
  return mismatches.length === 0 ? { kind: "correlated" } : { kind: "mismatch", fields: mismatches };
}

export function nextFailureState(
  attemptCount: number,
  now: Date,
): { readonly lifecycleState: "pending" | "manual_review"; readonly nextAttemptAt: Date } {
  const index = Math.min(Math.max(attemptCount, 1), MAX_INBOX_ATTEMPTS) - 1;
  const delay = RETRY_BACKOFF_MS[index] ?? RETRY_BACKOFF_MS[0];
  return {
    lifecycleState: attemptCount >= MAX_INBOX_ATTEMPTS ? "manual_review" : "pending",
    nextAttemptAt: new Date(now.getTime() + delay),
  };
}
