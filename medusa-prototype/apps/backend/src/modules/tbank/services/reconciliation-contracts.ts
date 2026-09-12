import type {
  ILockingModule,
  IPaymentModuleService,
  Logger,
  MedusaContainer,
  PaymentActions,
  PaymentSessionDTO,
} from "@medusajs/types";

import type { TBankClient } from "../lib/client";

export type NotificationRow = {
  readonly id: string;
  readonly payment_id: string;
  readonly status: string;
  readonly order_id: string;
  readonly amount_kopecks: number;
  readonly terminal_key: string;
  readonly success: boolean;
  readonly lifecycle_state: string;
  readonly attempt_count: number;
  readonly canonical_payload_hash?: string;
};

export type InboxMutationRow = {
  readonly id: string;
  readonly lifecycle_state?: string;
  readonly attempt_count?: number;
};

export interface TbankNotificationStore {
  quarantineExpiredExhausted(input: { readonly now: Date }): Promise<readonly InboxMutationRow[]>;
  claimNotificationById(input: { readonly id: string; readonly leaseToken: string; readonly now: Date }): Promise<readonly unknown[]>;
  claimInbox(input: { readonly limit: number; readonly leaseToken: string; readonly now: Date }): Promise<readonly unknown[]>;
  renewInboxLease(input: { readonly id: string; readonly leaseToken: string; readonly now: Date }): Promise<readonly unknown[]>;
  completeInbox(input: { readonly id: string; readonly leaseToken: string; readonly now: Date }): Promise<readonly unknown[]>;
  failInbox(input: { readonly id: string; readonly leaseToken: string; readonly now: Date }): Promise<readonly InboxMutationRow[]>;
  quarantineManualReview(input: { readonly id: string; readonly leaseToken: string; readonly now: Date }): Promise<readonly unknown[]>;
  retryManualReview(input: { readonly id: string; readonly now: Date; readonly operatorId: string; readonly reason: string }): Promise<readonly unknown[]>;
  resolveManualReview(input: { readonly id: string; readonly now: Date; readonly operatorId: string; readonly reason: string }): Promise<readonly unknown[]>;
  listTbankNotifications?(filters: Record<string, unknown>, config?: Record<string, unknown>): Promise<readonly Record<string, unknown>[]>;
  listTbankPaymentAttempts?(filters: Record<string, unknown>, config?: Record<string, unknown>): Promise<readonly Record<string, unknown>[]>;
  listTbankNotificationConflicts?(filters: Record<string, unknown>, config?: Record<string, unknown>): Promise<readonly Record<string, unknown>[]>;
  createTbankNotificationConflicts?(input: Record<string, unknown>): Promise<unknown>;
}

export type PaymentSessionService = Pick<
  IPaymentModuleService,
  "retrievePaymentSession" | "updatePaymentSession"
>;

export type ReconcilerWorkflowRunner = (
  input: {
    readonly action: PaymentActions;
    readonly data: { readonly session_id: string; readonly amount?: string | number };
  },
  options?: { readonly transactionId?: string; readonly idempotencyKey?: string },
) => Promise<{ readonly errors?: readonly unknown[]; readonly result?: unknown }>;

export type DurableLinkage = {
  readonly orderLinked: boolean;
  readonly orderId?: string;
  readonly paymentCaptured: boolean;
};

export type DurableLinkageChecker = (session: PaymentSessionDTO) => Promise<DurableLinkage>;

export type QueryService = {
  graph(input: {
    readonly entity: string;
    readonly fields: readonly string[];
    readonly filters?: Readonly<Record<string, unknown>>;
  }): Promise<{ readonly data: readonly Record<string, unknown>[] }>;
};

export type PaymentReconcilerDependencies = {
  readonly logger?: Logger;
  readonly notifications?: TbankNotificationStore;
  readonly payment?: PaymentSessionService;
  readonly locking?: ILockingModule;
  readonly tbankClient?: Pick<TBankClient, "getState">;
  readonly expectedTerminalKey?: string;
  readonly workflowRunner?: ReconcilerWorkflowRunner;
  readonly durableLinkageChecker?: DurableLinkageChecker;
  readonly query?: QueryService;
  readonly container?: MedusaContainer;
  readonly [key: string]: unknown;
};

export type ProcessNotificationResult =
  | { readonly status: "processed"; readonly id: string; readonly action: string }
  | { readonly status: "ignored"; readonly id: string; readonly reason: string }
  | { readonly status: "manual_review"; readonly id: string; readonly reason: string }
  | { readonly status: "retry_scheduled"; readonly id: string; readonly error: string }
  | { readonly status: "not_claimed"; readonly id: string };

export type ProcessBatchResult = {
  readonly claimed: number;
  readonly results: readonly ProcessNotificationResult[];
};

export type ManualReviewDetails = {
  readonly notification: Record<string, unknown>;
  readonly paymentAttempt: Record<string, unknown> | null;
  readonly conflicts: readonly Record<string, unknown>[];
  readonly paymentSession: PaymentSessionDTO | null;
};

export type ReconciliationServices = {
  readonly logger: Logger;
  readonly notifications: TbankNotificationStore;
  readonly payment: PaymentSessionService;
  readonly bank?: Pick<TBankClient, "getState">;
  readonly expectedTerminalKey: string;
  readonly workflow?: ReconcilerWorkflowRunner;
  readonly linkageChecker?: DurableLinkageChecker;
  readonly query?: QueryService;
  readonly container?: MedusaContainer;
};

export class InvalidInboxRowError extends Error {
  readonly name = "InvalidInboxRowError";
  constructor(readonly field: string) {
    super(`T-Bank inbox row has invalid ${field}`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function requiredString(row: Record<string, unknown>, field: string): string {
  const value = row[field];
  if (typeof value !== "string" || value.length === 0) throw new InvalidInboxRowError(field);
  return value;
}

export function parseNotificationRow(value: unknown): NotificationRow {
  if (!isRecord(value)) throw new InvalidInboxRowError("record");
  const row = value;
  const amountKopecks = row["amount_kopecks"];
  const success = row["success"];
  const attemptCount = row["attempt_count"];
  if (typeof amountKopecks !== "number") throw new InvalidInboxRowError("amount_kopecks");
  if (typeof success !== "boolean") throw new InvalidInboxRowError("success");
  if (typeof attemptCount !== "number") throw new InvalidInboxRowError("attempt_count");
  const canonicalHash = row["canonical_payload_hash"];
  return {
    id: requiredString(row, "id"),
    payment_id: requiredString(row, "payment_id"),
    status: requiredString(row, "status"),
    order_id: requiredString(row, "order_id"),
    amount_kopecks: amountKopecks,
    terminal_key: requiredString(row, "terminal_key"),
    success,
    lifecycle_state: requiredString(row, "lifecycle_state"),
    attempt_count: attemptCount,
    ...(typeof canonicalHash === "string" ? { canonical_payload_hash: canonicalHash } : {}),
  };
}
