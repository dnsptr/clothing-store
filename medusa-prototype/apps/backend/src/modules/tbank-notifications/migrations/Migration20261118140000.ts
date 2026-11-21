import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20261118140000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`create table if not exists "tbank_fiscal_receipt" (
      "id" text not null,
      "terminal_key" text not null,
      "payment_id" text not null,
      "order_id" text not null,
      "receipt_key" text not null,
      "receipt_type" text not null,
      "amount_kopecks" integer not null,
      "success" boolean not null,
      "error_code" text not null,
      "fn_number" text null,
      "fiscal_document_number" text null,
      "fiscal_document_attribute" text null,
      "receipt_datetime" text null,
      "fiscal_number" text null,
      "shift_number" text null,
      "ecr_reg_number" text null,
      "canonical_payload_hash" text not null,
      "lifecycle_state" text not null default 'awaiting_correlation',
      "operation_id" text null,
      "correlation_kind" text null,
      "processed_at" timestamptz null,
      "created_at" timestamptz not null default now(),
      "updated_at" timestamptz not null default now(),
      "deleted_at" timestamptz null,
      constraint "tbank_fiscal_receipt_pkey" primary key ("id"),
      constraint "tbank_fiscal_receipt_state_check" check ("lifecycle_state" in ('awaiting_correlation', 'processed', 'manual_review')),
      constraint "tbank_fiscal_receipt_kind_check" check ("correlation_kind" is null or "correlation_kind" in ('prepayment', 'refund', 'closing')),
      constraint "tbank_fiscal_receipt_amount_check" check ("amount_kopecks" >= 0)
    );`);
    this.addSql(`create unique index if not exists "IDX_tbank_fiscal_receipt_receipt_key_unique"
      on "tbank_fiscal_receipt" ("receipt_key") where "deleted_at" is null;`);
    this.addSql(`create index if not exists "IDX_tbank_fiscal_receipt_terminal_key_payment_id_lifecycle_state"
      on "tbank_fiscal_receipt" ("terminal_key", "payment_id", "lifecycle_state") where "deleted_at" is null;`);
    this.addSql(`create index if not exists "IDX_tbank_fiscal_receipt_operation_id"
      on "tbank_fiscal_receipt" ("operation_id") where "deleted_at" is null;`);
    this.addSql(`create index if not exists "IDX_tbank_fiscal_receipt_deleted_at"
      on "tbank_fiscal_receipt" ("deleted_at") where "deleted_at" is null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "tbank_fiscal_receipt";`);
  }
}
