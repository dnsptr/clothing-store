import type { Context } from "@medusajs/framework/types";
import type { EntityManager } from "@medusajs/framework/mikro-orm/knex";
import { InjectManager, MedusaContext, MedusaService } from "@medusajs/framework/utils";

import { INBOX_LEASE_MS, MAX_INBOX_ATTEMPTS } from "./lifecycle";
import TbankPaymentAttempt from "./models/tbank-payment-attempt";
import TbankNotification from "./models/tbank-notification";
import TbankNotificationConflict from "./models/tbank-notification-conflict";

type ClaimInput = { readonly limit: number; readonly leaseToken: string; readonly now: Date };
type LeaseInput = { readonly id: string; readonly leaseToken: string; readonly now: Date };
type ConflictInput = LeaseInput & { readonly reason: string };
type TransitionInput = { readonly now: Date };
export type InboxRow = { readonly id: string; readonly lifecycle_state: string; readonly attempt_count: number };
export type PollAttemptRow = {
  readonly id: string;
  readonly payment_session_id: string;
  readonly provider_id: string;
  readonly terminal_key: string;
  readonly order_id: string;
  readonly expected_amount_kopecks: number;
  readonly currency_code: string;
  readonly poll_count: number;
  readonly poll_payment_id?: string | null;
};
type PollInput = LeaseInput & { readonly reason?: string };


type OperatorActionInput = {
  readonly id: string;
  readonly now: Date;
  readonly operatorId: string;
  readonly reason: string;
};

export class InboxPersistenceError extends Error {
  readonly name = "InboxPersistenceError";
  constructor() {
    super("T-Bank inbox database manager is unavailable");
  }
}

export class InboxClaimLimitError extends Error {
  readonly name = "InboxClaimLimitError";
  constructor(readonly limit: number) {
    super(`T-Bank inbox claim limit must be between 1 and 100, received ${limit}`);
  }
}

class TbankNotificationModuleService extends MedusaService({
  TbankPaymentAttempt,
  TbankNotification,
  TbankNotificationConflict,
}) {

  @InjectManager()
  async quarantineExpiredExhausted(
    input: TransitionInput,
    @MedusaContext() context: Context<EntityManager> = {},
  ): Promise<readonly InboxRow[]> {
    if (!context.manager) throw new InboxPersistenceError();
    return context.manager.execute<InboxRow[]>(
      `WITH expired AS (
         SELECT id FROM tbank_notification
         WHERE lifecycle_state = 'leased' AND lease_expires_at <= ?
           AND attempt_count >= ${MAX_INBOX_ATTEMPTS} AND deleted_at IS NULL
         ORDER BY lease_expires_at ASC LIMIT 100
         FOR UPDATE SKIP LOCKED
       )
       UPDATE tbank_notification AS inbox
       SET lifecycle_state = 'manual_review', manual_review_at = ?,
           lease_token = NULL, lease_expires_at = NULL, updated_at = ?
       FROM expired
       WHERE inbox.id = expired.id
       RETURNING inbox.*`,
      [input.now, input.now, input.now],
    );
  }

  @InjectManager()
  async claimInbox(input: ClaimInput, @MedusaContext() context: Context<EntityManager> = {}): Promise<readonly InboxRow[]> {
    if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 100) {
      throw new InboxClaimLimitError(input.limit);
    }
    if (!context.manager) throw new InboxPersistenceError();
    return context.manager.execute<InboxRow[]>(
      `WITH claimable AS (
        SELECT id FROM tbank_notification
        WHERE ((lifecycle_state IN ('pending', 'awaiting_correlation')
            AND (next_attempt_at IS NULL OR next_attempt_at <= ?))
          OR (lifecycle_state = 'leased' AND lease_expires_at <= ?))
          AND attempt_count < ${MAX_INBOX_ATTEMPTS} AND deleted_at IS NULL
        ORDER BY created_at LIMIT ? FOR UPDATE SKIP LOCKED
      ) UPDATE tbank_notification AS inbox
        SET lifecycle_state = 'leased', lease_token = ?, lease_expires_at = ?,
            last_attempt_at = ?, attempt_count = attempt_count + 1, updated_at = ?
        FROM claimable WHERE inbox.id = claimable.id RETURNING inbox.*`,
      [input.now, input.now, input.limit, input.leaseToken, new Date(input.now.getTime() + INBOX_LEASE_MS), input.now, input.now],
    );
  }

  @InjectManager()
  async renewInboxLease(input: LeaseInput, @MedusaContext() context: Context<EntityManager> = {}): Promise<readonly InboxRow[]> {
    if (!context.manager) throw new InboxPersistenceError();
    return context.manager.execute<InboxRow[]>(
      `UPDATE tbank_notification SET lease_expires_at = ?, updated_at = ?
       WHERE id = ? AND lifecycle_state = 'leased' AND lease_token = ? AND lease_expires_at > ?
       RETURNING *`,
      [new Date(input.now.getTime() + INBOX_LEASE_MS), input.now, input.id, input.leaseToken, input.now],
    );
  }

  @InjectManager()
  async completeInbox(input: LeaseInput, @MedusaContext() context: Context<EntityManager> = {}): Promise<readonly InboxRow[]> {
    if (!context.manager) throw new InboxPersistenceError();
    return context.manager.execute<InboxRow[]>(
      `UPDATE tbank_notification SET lifecycle_state = 'processed', processed_at = ?,
         lease_token = NULL, lease_expires_at = NULL, updated_at = ?
       WHERE id = ? AND lifecycle_state = 'leased' AND lease_token = ? AND lease_expires_at > ? RETURNING *`,
      [input.now, input.now, input.id, input.leaseToken, input.now],
    );
  }

  @InjectManager()
  async failInbox(input: LeaseInput, @MedusaContext() context: Context<EntityManager> = {}): Promise<readonly InboxRow[]> {
    if (!context.manager) throw new InboxPersistenceError();
    return context.manager.execute<InboxRow[]>(
      `UPDATE tbank_notification
       SET lifecycle_state = CASE WHEN attempt_count >= ${MAX_INBOX_ATTEMPTS} THEN 'manual_review' ELSE 'pending' END,
         next_attempt_at = CAST(? AS timestamptz) + CASE attempt_count
           WHEN 1 THEN INTERVAL '1 minute' WHEN 2 THEN INTERVAL '5 minutes'
           WHEN 3 THEN INTERVAL '30 minutes' WHEN 4 THEN INTERVAL '2 hours'
           ELSE INTERVAL '12 hours' END,
         manual_review_at = CASE WHEN attempt_count >= ${MAX_INBOX_ATTEMPTS} THEN CAST(? AS timestamptz) ELSE NULL END,
         last_error_at = ?, lease_token = NULL, lease_expires_at = NULL, updated_at = ?
       WHERE id = ? AND lifecycle_state = 'leased' AND lease_token = ? AND lease_expires_at > ?
       RETURNING *`,
      [input.now, input.now, input.now, input.now, input.id, input.leaseToken, input.now],
    );
  }

  @InjectManager()
  async claimNotificationById(input: LeaseInput, @MedusaContext() context: Context<EntityManager> = {}): Promise<readonly InboxRow[]> {
    if (!context.manager) throw new InboxPersistenceError();
    return context.manager.execute<InboxRow[]>(
      `UPDATE tbank_notification AS inbox
       SET lifecycle_state = 'leased', lease_token = ?, lease_expires_at = ?,
           last_attempt_at = ?, attempt_count = attempt_count + 1, updated_at = ?
       WHERE inbox.id = ?
         AND ((lifecycle_state IN ('pending', 'awaiting_correlation')
             AND (next_attempt_at IS NULL OR next_attempt_at <= ?))
           OR (lifecycle_state = 'leased' AND lease_expires_at <= ?))
         AND attempt_count < ${MAX_INBOX_ATTEMPTS} AND deleted_at IS NULL
       RETURNING inbox.*`,
      [input.leaseToken, new Date(input.now.getTime() + INBOX_LEASE_MS), input.now, input.now, input.id, input.now, input.now],
    );
  }

  @InjectManager()
  async quarantineConflict(input: ConflictInput, @MedusaContext() context: Context<EntityManager> = {}): Promise<readonly InboxRow[]> {
    if (!context.manager) throw new InboxPersistenceError();
    return context.manager.execute<InboxRow[]>(
      `WITH quarantined AS (
         UPDATE tbank_notification
         SET lifecycle_state = 'manual_review', manual_review_at = ?,
             lease_token = NULL, lease_expires_at = NULL, last_error_at = ?, updated_at = ?
         WHERE id = ? AND lifecycle_state = 'leased' AND lease_token = ? AND lease_expires_at > ?
         RETURNING *
       ), conflict AS (
         INSERT INTO tbank_notification_conflict
         (id, canonical_notification_id, terminal_key, payment_id, status, canonical_payload_hash,
          conflicting_payload_hash, conflict_kind, correlation_failures, lifecycle_state, created_at, updated_at)
         SELECT
           'tbconf_' || substr(md5(random()::text), 1, 16),
           id, terminal_key, payment_id, status, canonical_payload_hash,
           COALESCE(canonical_payload_hash, ''), 'correlation_mismatch', ?, 'manual_review', ?, ?
         FROM quarantined
         RETURNING canonical_notification_id
       ) SELECT quarantined.* FROM quarantined
         INNER JOIN conflict ON conflict.canonical_notification_id = quarantined.id`,
      [input.now, input.now, input.now, input.id, input.leaseToken, input.now, input.reason, input.now, input.now],
    );
  }

  @InjectManager()
  async retryManualReview(
    input: OperatorActionInput,
    @MedusaContext() context: Context<EntityManager> = {},
  ): Promise<readonly InboxRow[]> {
    if (!context.manager) throw new InboxPersistenceError();
    return context.manager.execute<InboxRow[]>(
      `WITH updated AS (
         UPDATE tbank_notification
         SET lifecycle_state = 'pending', attempt_count = 0, next_attempt_at = ?,
             lease_token = NULL, lease_expires_at = NULL, manual_review_at = NULL, updated_at = ?
         WHERE id = ? AND lifecycle_state = 'manual_review' AND deleted_at IS NULL
         RETURNING *
       ), audit AS (
         INSERT INTO tbank_notification_conflict
          (id, canonical_notification_id, terminal_key, payment_id, status, canonical_payload_hash,
           conflicting_payload_hash, conflict_kind, correlation_failures, lifecycle_state, created_at, updated_at)
         SELECT
            'tbconf_' || substr(md5(random()::text), 1, 16),
            id, terminal_key, payment_id, status, canonical_payload_hash,
            repeat('0', 64),
            'operator_retry',
            ?,
            'manual_review',
            ?,
            ?
          FROM updated
          RETURNING canonical_notification_id
       ) SELECT updated.* FROM updated
         INNER JOIN audit ON audit.canonical_notification_id = updated.id`,
      [
        input.now,
        input.now,
        input.id,
        JSON.stringify({ operatorId: input.operatorId, reason: input.reason, action: "retry" }),
        input.now,
        input.now,
      ],
    );
  }

  @InjectManager()
  async resolveManualReview(
    input: OperatorActionInput,
    @MedusaContext() context: Context<EntityManager> = {},
  ): Promise<readonly InboxRow[]> {
    if (!context.manager) throw new InboxPersistenceError();
    return context.manager.execute<InboxRow[]>(
      `WITH updated AS (
         UPDATE tbank_notification
         SET lifecycle_state = 'processed', processed_at = ?,
             lease_token = NULL, lease_expires_at = NULL, updated_at = ?
         WHERE id = ? AND lifecycle_state = 'manual_review' AND deleted_at IS NULL
         RETURNING *
       ), audit AS (
         INSERT INTO tbank_notification_conflict
          (id, canonical_notification_id, terminal_key, payment_id, status, canonical_payload_hash,
           conflicting_payload_hash, conflict_kind, correlation_failures, lifecycle_state, created_at, updated_at)
         SELECT
            'tbconf_' || substr(md5(random()::text), 1, 16),
            id, terminal_key, payment_id, status, canonical_payload_hash,
            repeat('0', 64),
            'operator_resolve',
           ?,
            'manual_review',
            ?,
            ?
          FROM updated
          RETURNING canonical_notification_id
       ) SELECT updated.* FROM updated
         INNER JOIN audit ON audit.canonical_notification_id = updated.id`,
      [
        input.now,
        input.now,
        input.id,
        JSON.stringify({ operatorId: input.operatorId, reason: input.reason, action: "resolve" }),
        input.now,
        input.now,
      ],
    );
  }
  @InjectManager()
  async claimDuePaymentAttempts(
    input: ClaimInput,
    @MedusaContext() context: Context<EntityManager> = {},
  ): Promise<readonly PollAttemptRow[]> {
    if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 100) {
      throw new InboxClaimLimitError(input.limit);
    }
    if (!context.manager) throw new InboxPersistenceError();
    await context.manager.execute(
      `WITH expired AS (
         SELECT id FROM tbank_payment_attempt
         WHERE poll_state = 'leased' AND poll_lease_expires_at <= ?
           AND poll_count >= ${MAX_INBOX_ATTEMPTS} AND deleted_at IS NULL
         ORDER BY poll_lease_expires_at FOR UPDATE SKIP LOCKED LIMIT 100
       )
       UPDATE tbank_payment_attempt AS a
       SET poll_state = 'manual_review', poll_manual_review_at = ?,
           poll_error = 'Polling lease expired after maximum attempts',
           poll_lease_token = NULL, poll_lease_expires_at = NULL, updated_at = ?
       FROM expired WHERE a.id = expired.id`,
      [input.now, input.now, input.now],
    );
    return context.manager.execute<PollAttemptRow[]>(
      `WITH due AS (
         SELECT a.id FROM tbank_payment_attempt a
         WHERE a.created_at <= ? AND a.deleted_at IS NULL AND a.poll_count < ${MAX_INBOX_ATTEMPTS}
           AND ((a.poll_state = 'pending' AND (a.poll_next_at IS NULL OR a.poll_next_at <= ?))
             OR (a.poll_state = 'leased' AND a.poll_lease_expires_at <= ?))
           AND NOT EXISTS (
             SELECT 1 FROM tbank_notification n WHERE n.deleted_at IS NULL
               AND n.terminal_key = a.terminal_key AND n.order_id = a.order_id
               AND n.status = 'CONFIRMED'
           )
         ORDER BY a.created_at FOR UPDATE OF a SKIP LOCKED LIMIT ?
       ) UPDATE tbank_payment_attempt AS a
         SET poll_state = 'leased', poll_lease_token = ?, poll_lease_expires_at = ?,
             poll_count = poll_count + 1, updated_at = ?
         FROM due WHERE a.id = due.id RETURNING a.*`,
      [new Date(input.now.getTime() - 15 * 60_000), input.now, input.now, input.limit,
        input.leaseToken, new Date(input.now.getTime() + INBOX_LEASE_MS), input.now],
    );
  }

  @InjectManager()
  async renewPaymentAttemptPoll(
    input: LeaseInput,
    @MedusaContext() context: Context<EntityManager> = {},
  ): Promise<readonly PollAttemptRow[]> {
    if (!context.manager) throw new InboxPersistenceError();
    return context.manager.execute<PollAttemptRow[]>(
      `UPDATE tbank_payment_attempt SET poll_lease_expires_at = ?, updated_at = ?
       WHERE id = ? AND poll_state = 'leased' AND poll_lease_token = ?
         AND poll_lease_expires_at > ? RETURNING *`,
      [new Date(input.now.getTime() + INBOX_LEASE_MS), input.now, input.id, input.leaseToken, input.now],
    );
  }

  @InjectManager()
  async observePaymentAttemptPoll(
    input: LeaseInput & { readonly paymentId: string; readonly status: string },
    @MedusaContext() context: Context<EntityManager> = {},
  ): Promise<readonly PollAttemptRow[]> {
    if (!context.manager) throw new InboxPersistenceError();
    return context.manager.execute<PollAttemptRow[]>(
      `UPDATE tbank_payment_attempt SET poll_checked_at = ?, poll_bank_status = ?,
         poll_payment_id = COALESCE(poll_payment_id, ?),
         poll_confirmed_at = CASE WHEN ? = 'CONFIRMED' THEN COALESCE(poll_confirmed_at, ?) ELSE poll_confirmed_at END,
         updated_at = ?
       WHERE id = ? AND poll_state = 'leased' AND poll_lease_token = ?
         AND poll_lease_expires_at > ? AND (poll_payment_id IS NULL OR poll_payment_id = ?) RETURNING *`,
      [input.now, input.status, input.paymentId, input.status, input.now, input.now,
        input.id, input.leaseToken, input.now, input.paymentId],
    );
  }

  @InjectManager()
  async finishPaymentAttemptPoll(
    input: PollInput & { readonly outcome: "completed" | "manual_review" | "retry" },
    @MedusaContext() context: Context<EntityManager> = {},
  ): Promise<readonly PollAttemptRow[]> {
    if (!context.manager) throw new InboxPersistenceError();
    return context.manager.execute<PollAttemptRow[]>(
      `UPDATE tbank_payment_attempt
       SET poll_state = CASE WHEN ? = 'retry'
           THEN CASE WHEN poll_count >= ${MAX_INBOX_ATTEMPTS} THEN 'manual_review' ELSE 'pending' END
           ELSE ? END,
         poll_next_at = CASE WHEN ? = 'retry' AND poll_count < ${MAX_INBOX_ATTEMPTS}
           THEN CAST(? AS timestamptz) + CASE poll_count
             WHEN 1 THEN INTERVAL '1 minute' WHEN 2 THEN INTERVAL '5 minutes'
             WHEN 3 THEN INTERVAL '30 minutes' ELSE INTERVAL '2 hours' END
           ELSE NULL END,
         poll_manual_review_at = CASE WHEN ? = 'manual_review'
             OR (? = 'retry' AND poll_count >= ${MAX_INBOX_ATTEMPTS}) THEN CAST(? AS timestamptz) ELSE NULL END,
         poll_completed_at = CASE WHEN ? = 'completed' THEN ? ELSE poll_completed_at END,
         poll_error = ?, poll_lease_token = NULL, poll_lease_expires_at = NULL, updated_at = ?
       WHERE id = ? AND poll_state = 'leased' AND poll_lease_token = ?
         AND poll_lease_expires_at > ? RETURNING *`,
      [input.outcome, input.outcome, input.outcome, input.now,
        input.outcome, input.outcome, input.now, input.outcome, input.now,
        input.reason ?? null, input.now, input.id, input.leaseToken, input.now],
    );
  }
  @InjectManager()
  async transitionPollManualReview(
    input: { readonly id: string; readonly now: Date; readonly operatorId: string; readonly reason: string; readonly outcome: "pending" | "completed" },
    @MedusaContext() context: Context<EntityManager> = {},
  ): Promise<readonly PollAttemptRow[]> {
    if (!context.manager) throw new InboxPersistenceError();
    return context.manager.execute<PollAttemptRow[]>(
      `WITH updated AS (
         UPDATE tbank_payment_attempt
         SET poll_state = ?, poll_count = CASE WHEN ? = 'pending' THEN 0 ELSE poll_count END,
             poll_next_at = CASE WHEN ? = 'pending' THEN CAST(? AS timestamptz) ELSE NULL END,
             poll_completed_at = CASE WHEN ? = 'completed' THEN CAST(? AS timestamptz) ELSE poll_completed_at END,
             poll_manual_review_at = NULL, poll_lease_token = NULL, poll_lease_expires_at = NULL,
             updated_at = ?
         WHERE id = ? AND poll_state = 'manual_review' AND deleted_at IS NULL RETURNING *
       ), audit AS (
         INSERT INTO tbank_notification_conflict
           (id, canonical_notification_id, terminal_key, payment_id, status,
            canonical_payload_hash, conflicting_payload_hash, conflict_kind,
            correlation_failures, lifecycle_state, created_at, updated_at)
         SELECT 'tbconf_' || substr(md5(random()::text), 1, 16),
           NULL, terminal_key, COALESCE(poll_payment_id, 'attempt:' || id),
           COALESCE(poll_bank_status, 'UNKNOWN'), NULL, repeat('0', 64),
           ?, jsonb_build_object('attemptId', id, 'operatorId', CAST(? AS text), 'reason', CAST(? AS text),
             'previousError', poll_error)::text, 'manual_review', ?, ?
         FROM updated RETURNING id
       ) SELECT updated.* FROM updated INNER JOIN audit ON true`,
      [input.outcome, input.outcome, input.outcome, input.now,
        input.outcome, input.now, input.now, input.id,
        input.outcome === "pending" ? "operator_poll_retry" : "operator_poll_resolve",
        input.operatorId, input.reason, input.now, input.now],
    );
  }
}

export default TbankNotificationModuleService;
