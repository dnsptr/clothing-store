import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20261118150000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`create table "tbank_refund_operation" (
      "id" text primary key, "kind" text not null check ("kind" in ('prepayment','refund','closing')),
      "payment_id" text not null, "payment_session_id" text not null, "bank_payment_id" text not null,
      "terminal_key" text not null, "idempotency_key" text not null, "request_hash" text not null,
      "snapshot_hash" text not null, "external_request_id" text not null,
      "amount_kopecks" integer not null check ("amount_kopecks" > 0),
      "original_amount_kopecks" integer not null check ("original_amount_kopecks" > 0),
      "balance_before_kopecks" integer not null check ("balance_before_kopecks" >= "amount_kopecks"),
      "credit_amount_kopecks" integer not null check ("credit_amount_kopecks" >= 0),
      "selections" jsonb not null, "receipt_mode" text not null check ("receipt_mode" in ('prepayment','full_payment')),
      "state" text not null default 'prepared' check ("state" in ('prepared','submitting','succeeded','rejected','indeterminate')),
      "fiscal_state" text not null default 'pending' check ("fiscal_state" in ('pending','succeeded','failed')),
      "fiscal_receipt_id" text null, "fiscal_receipt_type" text null, "native_refund_id" text null,
      "error_code" text null, "operator_id" text not null, "note" text null, "refund_reason_id" text null, "submitted_at" timestamptz null,
      "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null
    );`);
    this.addSql(`create unique index "tbank_refund_operation_request_uq" on "tbank_refund_operation" ("payment_id","idempotency_key") where "deleted_at" is null;`);
    this.addSql(`create index "tbank_refund_operation_bank_idx" on "tbank_refund_operation" ("terminal_key","bank_payment_id","state") where "deleted_at" is null;`);
    this.addSql(`create index "tbank_refund_operation_recovery_idx" on "tbank_refund_operation" ("state","updated_at") where "deleted_at" is null;`);
    this.addSql(`create function "tbank_refund_operation_immutable"() returns trigger language plpgsql as $$ begin
      if row(new.kind,new.payment_id,new.payment_session_id,new.bank_payment_id,new.terminal_key,new.idempotency_key,
        new.request_hash,new.snapshot_hash,new.external_request_id,new.amount_kopecks,new.original_amount_kopecks,
        new.balance_before_kopecks,new.credit_amount_kopecks,new.selections,new.receipt_mode,new.operator_id,new.note,new.refund_reason_id)
      is distinct from row(old.kind,old.payment_id,old.payment_session_id,old.bank_payment_id,old.terminal_key,old.idempotency_key,
        old.request_hash,old.snapshot_hash,old.external_request_id,old.amount_kopecks,old.original_amount_kopecks,
        old.balance_before_kopecks,old.credit_amount_kopecks,old.selections,old.receipt_mode,old.operator_id,old.note,old.refund_reason_id)
      then raise exception 'T-Bank refund request is immutable'; end if; return new; end $$;`);
    this.addSql(`create trigger "tbank_refund_operation_immutable_trg" before update on "tbank_refund_operation" for each row execute function "tbank_refund_operation_immutable"();`);
  }
  override async down(): Promise<void> {
    this.addSql(`drop table if exists "tbank_refund_operation" cascade;`);
    this.addSql(`drop function if exists "tbank_refund_operation_immutable"();`);
  }
}
