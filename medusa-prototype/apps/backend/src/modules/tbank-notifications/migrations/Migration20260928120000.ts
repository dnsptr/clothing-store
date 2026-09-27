import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260928120000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`alter table "tbank_payment_attempt"
      add column "poll_retry_until" timestamptz null,
      add column "poll_alert_sent_at" timestamptz null,
      add column "poll_alert_lease_token" text null,
      add column "poll_alert_lease_expires_at" timestamptz null;`);
    this.addSql(`create table "tbank_payment_attempt_action" (
      "id" text not null,
      "payment_attempt_id" text not null,
      "action" text not null,
      "operator_id" text not null,
      "reason" text not null,
      "created_at" timestamptz not null default now(),
      "updated_at" timestamptz not null default now(),
      "deleted_at" timestamptz null,
      constraint "tbank_payment_attempt_action_pkey" primary key ("id"),
      constraint "FK_tbank_payment_attempt_action_payment_attempt_id"
        foreign key ("payment_attempt_id") references "tbank_payment_attempt" ("id") on update cascade on delete restrict,
      constraint "CHK_tbank_payment_attempt_action_action" check ("action" in ('retry', 'resolve'))
    );`);
    this.addSql(`create index "IDX_tbank_payment_attempt_action_payment_attempt_id_created_at"
      on "tbank_payment_attempt_action" ("payment_attempt_id", "created_at") where deleted_at is null;`);
    this.addSql(`create index "IDX_tbank_payment_attempt_poll_alert_pending"
      on "tbank_payment_attempt" ("poll_manual_review_at", "id")
      where deleted_at is null and poll_state = 'manual_review' and poll_alert_sent_at is null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop index if exists "IDX_tbank_payment_attempt_poll_alert_pending";`);
    this.addSql(`drop table if exists "tbank_payment_attempt_action";`);
    this.addSql(`alter table "tbank_payment_attempt"
      drop column if exists "poll_retry_until",
      drop column if exists "poll_alert_sent_at",
      drop column if exists "poll_alert_lease_token",
      drop column if exists "poll_alert_lease_expires_at";`);
  }
}
