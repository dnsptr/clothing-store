import type { Context } from "@medusajs/framework/types";
import type { EntityManager } from "@medusajs/framework/mikro-orm/knex";
import { InjectManager, MedusaContext, MedusaService } from "@medusajs/framework/utils";

import { INBOX_LEASE_MS, nextFailureState } from "./lifecycle";
import TbankNotification from "./models/tbank-notification";
import TbankNotificationConflict from "./models/tbank-notification-conflict";

type ClaimInput = { readonly limit: number; readonly leaseToken: string; readonly now: Date };
type LeaseInput = { readonly id: string; readonly leaseToken: string; readonly now: Date };
type FailureInput = LeaseInput & { readonly attemptCount: number };
type InboxRow = { readonly id: string; readonly lifecycle_state: string };

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
  TbankNotification,
  TbankNotificationConflict,
}) {
  @InjectManager()
  async claimInbox(input: ClaimInput, @MedusaContext() context: Context<EntityManager> = {}): Promise<readonly InboxRow[]> {
    if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 100) {
      throw new InboxClaimLimitError(input.limit);
    }
    if (!context.manager) throw new InboxPersistenceError();
    return context.manager.execute<InboxRow[]>(
      `WITH claimable AS (
        SELECT id FROM tbank_notification
        WHERE lifecycle_state IN ('pending', 'awaiting_correlation')
          AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
          AND (lease_expires_at IS NULL OR lease_expires_at <= ?)
          AND attempt_count < 5 AND deleted_at IS NULL
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
       WHERE id = ? AND lifecycle_state = 'leased' AND lease_token = ? RETURNING *`,
      [input.now, input.now, input.id, input.leaseToken],
    );
  }

  @InjectManager()
  async failInbox(input: FailureInput, @MedusaContext() context: Context<EntityManager> = {}): Promise<readonly InboxRow[]> {
    if (!context.manager) throw new InboxPersistenceError();
    const failure = nextFailureState(input.attemptCount, input.now);
    return context.manager.execute<InboxRow[]>(
      `UPDATE tbank_notification SET lifecycle_state = ?, next_attempt_at = ?,
         manual_review_at = CASE WHEN ? = 'manual_review' THEN ? ELSE NULL END,
         last_error_at = ?, lease_token = NULL, lease_expires_at = NULL, updated_at = ?
       WHERE id = ? AND lifecycle_state = 'leased' AND lease_token = ? RETURNING *`,
      [failure.lifecycleState, failure.nextAttemptAt, failure.lifecycleState, input.now, input.now, input.now, input.id, input.leaseToken],
    );
  }
}

export default TbankNotificationModuleService;
