import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20261011100000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`alter table "tbank_payment_attempt"
      drop constraint "CHK_tbank_payment_attempt_poll_state",
      drop constraint "CHK_tbank_payment_attempt_poll_errors";`);
    this.addSql(`alter table "tbank_payment_attempt"
      add column "poll_count" integer not null default 0,
      add column "poll_checked_at" timestamptz null,
      add column "poll_bank_status" text null,
      add column "poll_confirmed_at" timestamptz null,
      add column "poll_payment_id" text null,
      add column "poll_error" text null,
      add column "poll_completed_at" timestamptz null;`);
    // Keep outstanding leases, deadlines and retry history. Main's historical
    // terminal-outcome backfill stays completed rather than reopening paid orders.
    this.addSql(`update "tbank_payment_attempt"
      set poll_state = case when poll_state = 'complete' then 'completed' else poll_state end,
          poll_count = poll_consecutive_errors,
          poll_completed_at = case when poll_state = 'complete' then updated_at else null end;`);
    this.addSql(`drop index "IDX_tbank_payment_attempt_terminal_key_poll_state_poll_next_at";`);
    this.addSql(`alter table "tbank_payment_attempt" drop column "poll_consecutive_errors";`);
    this.addSql(`alter table "tbank_payment_attempt"
      add constraint "CHK_tbank_payment_attempt_poll_state" check ("poll_state" in ('pending', 'leased', 'completed', 'manual_review')),
      add constraint "CHK_tbank_payment_attempt_poll_count" check ("poll_count" between 0 and 5);`);
    this.addSql(`create index "IDX_tbank_payment_attempt_poll_state_poll_next_at_poll_lease_expires_at"
      on "tbank_payment_attempt" ("poll_state", "poll_next_at", "poll_lease_expires_at") where deleted_at is null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop index if exists "IDX_tbank_payment_attempt_poll_state_poll_next_at_poll_lease_expires_at";`);
    this.addSql(`alter table "tbank_payment_attempt"
      drop constraint "CHK_tbank_payment_attempt_poll_state",
      drop constraint "CHK_tbank_payment_attempt_poll_count",
      add column "poll_consecutive_errors" integer not null default 0;`);
    this.addSql(`update "tbank_payment_attempt"
      set poll_state = case when poll_state = 'completed' then 'complete' else poll_state end,
          poll_consecutive_errors = poll_count;`);
    this.addSql(`alter table "tbank_payment_attempt"
      drop column "poll_count", drop column "poll_checked_at",
      drop column "poll_payment_id", drop column "poll_bank_status", drop column "poll_confirmed_at",
      drop column "poll_error", drop column "poll_completed_at",
      add constraint "CHK_tbank_payment_attempt_poll_state"
        check ("poll_state" in ('pending', 'leased', 'complete', 'manual_review')),
      add constraint "CHK_tbank_payment_attempt_poll_errors"
        check ("poll_consecutive_errors" between 0 and 5);`);
    this.addSql(`create index "IDX_tbank_payment_attempt_terminal_key_poll_state_poll_next_at"
      on "tbank_payment_attempt" ("terminal_key", "poll_state", "poll_next_at") where deleted_at is null;`);
  }
}
