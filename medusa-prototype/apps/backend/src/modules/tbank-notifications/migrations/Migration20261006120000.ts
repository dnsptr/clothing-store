import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20261006120000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`create table if not exists "tbank_fiscal_notification" (
      "id" text not null,
      "fingerprint" text not null,
      "terminal_key" text not null,
      "payment_id" text null,
      "order_id" text null,
      "status" text null,
      "receipt_type" text null,
      "success" boolean null,
      "amount_kopecks" integer null,
      "error_code" text null,
      "fn_number" text null,
      "fiscal_document_number" text null,
      "review_reason" text null,
      "review_state" text not null default 'manual_review',
      "created_at" timestamptz not null default now(),
      "updated_at" timestamptz not null default now(),
      "deleted_at" timestamptz null,
      constraint "tbank_fiscal_notification_pkey" primary key ("id"),
      constraint "CHK_tbank_fiscal_notification_review_state"
        check ("review_state" in ('observed', 'manual_review'))
    );`);
    this.addSql(`create index if not exists "IDX_tbank_fiscal_notification_deleted_at" on "tbank_fiscal_notification" ("deleted_at") where deleted_at is null;`);
    this.addSql(`create unique index if not exists "IDX_tbank_fiscal_notification_fingerprint_unique" on "tbank_fiscal_notification" ("fingerprint") where deleted_at is null;`);
    this.addSql(`create index if not exists "IDX_tbank_fiscal_notification_review_state_created_at" on "tbank_fiscal_notification" ("review_state", "created_at") where deleted_at is null;`);
    this.addSql(`create index if not exists "IDX_tbank_fiscal_notification_terminal_key_payment_id" on "tbank_fiscal_notification" ("terminal_key", "payment_id") where deleted_at is null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "tbank_fiscal_notification";`);
  }
}
