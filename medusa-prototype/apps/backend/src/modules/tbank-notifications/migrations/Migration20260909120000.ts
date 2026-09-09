import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260909120000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`alter table "tbank_notification" add column if not exists "terminal_key" text null, add column if not exists "currency_code" text null, add column if not exists "canonical_payload_hash" text null, add column if not exists "lifecycle_state" text null, add column if not exists "attempt_count" integer not null default 0, add column if not exists "next_attempt_at" timestamptz null, add column if not exists "last_attempt_at" timestamptz null, add column if not exists "last_error_at" timestamptz null, add column if not exists "lease_token" text null, add column if not exists "lease_expires_at" timestamptz null, add column if not exists "processed_at" timestamptz null, add column if not exists "manual_review_at" timestamptz null;`);
    this.addSql(`update "tbank_notification" set "terminal_key" = 'legacy', "currency_code" = 'rub', "canonical_payload_hash" = repeat('0', 64), "lifecycle_state" = 'processed', "processed_at" = coalesce("processed_at", "created_at") where "terminal_key" is null;`);
    this.addSql(`alter table "tbank_notification" alter column "terminal_key" set not null, alter column "currency_code" set not null, alter column "canonical_payload_hash" set not null, alter column "lifecycle_state" set not null, alter column "lifecycle_state" set default 'pending';`);
    this.addSql(`alter table "tbank_notification" add constraint "CHK_tbank_notification_lifecycle" check ("lifecycle_state" in ('pending', 'awaiting_correlation', 'leased', 'processed', 'manual_review')), add constraint "CHK_tbank_notification_attempt_count" check ("attempt_count" between 0 and 5);`);
    this.addSql(`drop index if exists "IDX_tbank_notification_payment_id_status_unique";`);
    this.addSql(`create unique index "IDX_tbank_notification_terminal_key_payment_id_status_unique" on "tbank_notification" ("terminal_key", "payment_id", "status") where deleted_at is null;`);
    this.addSql(`create index "IDX_tbank_notification_lifecycle_state_next_attempt_at_lease_expires_at" on "tbank_notification" ("lifecycle_state", "next_attempt_at", "lease_expires_at") where deleted_at is null;`);
    this.addSql(`create table "tbank_notification_conflict" ("id" text not null, "canonical_notification_id" text null, "terminal_key" text not null, "payment_id" text not null, "status" text not null, "canonical_payload_hash" text null, "conflicting_payload_hash" text not null, "conflict_kind" text not null, "correlation_failures" text null, "lifecycle_state" text not null default 'manual_review', "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "tbank_notification_conflict_pkey" primary key ("id"), constraint "CHK_tbank_notification_conflict_state" check ("lifecycle_state" = 'manual_review'));`);
    this.addSql(`create index "IDX_tbank_notification_conflict_deleted_at" on "tbank_notification_conflict" ("deleted_at") where deleted_at is null;`);
    this.addSql(`create index "IDX_tbank_notification_conflict_payment_id_status" on "tbank_notification_conflict" ("payment_id", "status") where deleted_at is null;`);
    this.addSql(`create index "IDX_tbank_notification_conflict_canonical_notification_id" on "tbank_notification_conflict" ("canonical_notification_id") where deleted_at is null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "tbank_notification_conflict" cascade;`);
    this.addSql(`drop index if exists "IDX_tbank_notification_lifecycle_state_next_attempt_at_lease_expires_at";`);
    this.addSql(`drop index if exists "IDX_tbank_notification_terminal_key_payment_id_status_unique";`);
    this.addSql(`alter table "tbank_notification" drop constraint if exists "CHK_tbank_notification_lifecycle", drop constraint if exists "CHK_tbank_notification_attempt_count";`);
    this.addSql(`alter table "tbank_notification" drop column if exists "terminal_key", drop column if exists "currency_code", drop column if exists "canonical_payload_hash", drop column if exists "lifecycle_state", drop column if exists "attempt_count", drop column if exists "next_attempt_at", drop column if exists "last_attempt_at", drop column if exists "last_error_at", drop column if exists "lease_token", drop column if exists "lease_expires_at", drop column if exists "processed_at", drop column if exists "manual_review_at";`);
    this.addSql(`create unique index if not exists "IDX_tbank_notification_payment_id_status_unique" on "tbank_notification" ("payment_id", "status") where deleted_at is null;`);
  }
}
