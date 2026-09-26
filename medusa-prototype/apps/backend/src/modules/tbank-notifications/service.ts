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
         ORDER BY lease_expires_at ASC
         FOR UPDATE SKIP LOCKED
         LIMIT 100
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
        ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT ?
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
}

export default TbankNotificationModuleService;
