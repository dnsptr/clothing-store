import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260926150000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`alter table "tbank_payment_attempt"
      add column "poll_state" text not null default 'pending',
      add column "poll_next_at" timestamptz null,
      add column "poll_lease_token" text null,
      add column "poll_lease_expires_at" timestamptz null,
      add column "poll_consecutive_errors" integer not null default 0,
      add column "poll_manual_review_at" timestamptz null;`);
    // Webhook rows are normally inserted without payment_attempt_id. Only backfill
    // processed confirmations or failures corroborated by the current session state.
    this.addSql(`update "tbank_payment_attempt" as attempt
      set poll_state = 'complete', updated_at = now()
      where attempt.deleted_at is null and exists (
        select 1 from "tbank_notification" as inbox
        where inbox.order_id = attempt.order_id and inbox.terminal_key = attempt.terminal_key
          and ((inbox.status = 'CONFIRMED' and inbox.success = true)
            or (inbox.status in ('REJECTED', 'DEADLINE_EXPIRED', 'CANCELED', 'REVERSED')
              and inbox.success = false and exists (
                select 1 from "payment_session" as session
                where session.id = attempt.payment_session_id and session.deleted_at is null
                  and session.status in ('error', 'canceled')
                  and session.data->>'status' = inbox.status
              )))
          and inbox.lifecycle_state = 'processed' and inbox.deleted_at is null
      );`);
    this.addSql(`alter table "tbank_payment_attempt"
      add constraint "CHK_tbank_payment_attempt_poll_state"
        check (poll_state in ('pending', 'leased', 'complete', 'manual_review')),
      add constraint "CHK_tbank_payment_attempt_poll_errors"
        check (poll_consecutive_errors between 0 and 5);`);
    this.addSql(`create index "IDX_tbank_payment_attempt_terminal_key_poll_state_poll_next_at"
      on "tbank_payment_attempt" ("terminal_key", "poll_state", "poll_next_at")
      where deleted_at is null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop index if exists "IDX_tbank_payment_attempt_terminal_key_poll_state_poll_next_at";`);
    this.addSql(`alter table "tbank_payment_attempt"
      drop constraint if exists "CHK_tbank_payment_attempt_poll_state",
      drop constraint if exists "CHK_tbank_payment_attempt_poll_errors",
      drop column if exists "poll_state",
      drop column if exists "poll_next_at",
      drop column if exists "poll_lease_token",
      drop column if exists "poll_lease_expires_at",
      drop column if exists "poll_consecutive_errors",
      drop column if exists "poll_manual_review_at";`);
  }
}
