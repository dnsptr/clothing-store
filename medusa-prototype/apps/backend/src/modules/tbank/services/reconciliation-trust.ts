import type { PaymentSessionDTO } from "@medusajs/types";

import { correlateNotification, type AuthenticatedNotification } from "../../tbank-notifications/lifecycle";
import { isTBankStatus } from "../lib/status";
import type { TBankGetStateResult } from "../lib/client";
import type {
  DurableLinkage,
  NotificationRow,
  ReconciliationServices,
} from "./reconciliation-contracts";

export class LinkageUnavailableError extends Error {
  readonly name = "LinkageUnavailableError";
  constructor(message: string, readonly cause?: unknown) {
    super(message);
  }
}

export type TrustResult = { readonly valid: true } | { readonly valid: false; readonly reason: string };

const TERMINAL_RECONCILIATION_STATUSES = [
  "AUTHORIZED",
  "CONFIRMED",
  "REJECTED",
  "DEADLINE_EXPIRED",
  "CANCELED",
  "REVERSED",
] as const;

export function correlateRow(
  row: NotificationRow,
  session: PaymentSessionDTO,
  expectedTerminalKey: string,
): TrustResult {
  const notification: AuthenticatedNotification = {
    terminalKey: row.terminal_key,
    orderId: row.order_id,
    paymentId: row.payment_id,
    status: row.status,
    amountKopecks: row.amount_kopecks,
    amountProvided: true,
    currencyCode: "rub",
    success: row.success,
  };
  const result = correlateNotification(notification, session, expectedTerminalKey);
  return result.kind === "correlated"
    ? { valid: true }
    : { valid: false, reason: `Correlation mismatch: ${result.fields.join(", ")}` };
}

export function validateBankState(
  bankState: TBankGetStateResult,
  row: NotificationRow,
  expectedTerminalKey: string,
): TrustResult {
  if (bankState.Success !== true) return { valid: false, reason: "Bank GetState Success is not true" };
  const terminalKey = bankState["TerminalKey"];
  if (typeof terminalKey !== "string" || terminalKey !== expectedTerminalKey) {
    return { valid: false, reason: "Bank GetState TerminalKey is missing or mismatched" };
  }
  if (String(bankState.PaymentId ?? "") !== row.payment_id) {
    return { valid: false, reason: "Bank GetState PaymentId is missing or mismatched" };
  }
  if (typeof bankState.OrderId !== "string" || bankState.OrderId !== row.order_id) {
    return { valid: false, reason: "Bank GetState OrderId is missing or mismatched" };
  }
  if (typeof bankState.Amount !== "number" || bankState.Amount !== row.amount_kopecks) {
    return { valid: false, reason: "Bank GetState Amount is missing or mismatched" };
  }
  if (
    typeof bankState.Status !== "string" ||
    !isTBankStatus(bankState.Status) ||
    !TERMINAL_RECONCILIATION_STATUSES.some((status) => status === bankState.Status)
  ) {
    return { valid: false, reason: "Bank GetState status is not a terminal reconciliation status" };
  }
  return { valid: true };
}

export async function checkDurableLinkage(
  services: ReconciliationServices,
  session: PaymentSessionDTO,
): Promise<DurableLinkage> {
  if (services.linkageChecker) return services.linkageChecker(session);
  if (!services.query) throw new LinkageUnavailableError("Durable order linkage query is unavailable");
  try {
    const cartLinks = session.payment_collection_id
      ? await services.query.graph({
          entity: "cart_payment_collection",
          fields: ["cart_id"],
          filters: { payment_collection_id: session.payment_collection_id },
        })
      : { data: [] };
    const cartId = cartLinks.data[0]?.["cart_id"];
    const orderLinks = typeof cartId === "string"
      ? await services.query.graph({ entity: "order_cart", fields: ["order_id"], filters: { cart_id: cartId } })
      : { data: [] };
    const orderId = orderLinks.data[0]?.["order_id"];
    const payments = await services.query.graph({
      entity: "payment",
      fields: ["id", "captured_at"],
      filters: { payment_session_id: session.id },
    });
    const capturedAt = payments.data[0]?.["captured_at"];
    return {
      orderLinked: typeof orderId === "string" && orderId.length > 0,
      ...(typeof orderId === "string" ? { orderId } : {}),
      paymentCaptured: payments.data.length > 0 && capturedAt !== null && capturedAt !== undefined,
    };
  } catch (error) {
    throw new LinkageUnavailableError("Durable order linkage query failed", error);
  }
}
