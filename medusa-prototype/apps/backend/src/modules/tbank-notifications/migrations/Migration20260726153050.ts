import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260726153050 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "tbank_notification" drop constraint if exists "tbank_notification_payment_id_status_unique";`);
    this.addSql(`create table if not exists "tbank_notification" ("id" text not null, "payment_id" text not null, "status" text not null, "order_id" text not null, "amount_kopecks" integer not null, "success" boolean not null, "error_code" text null, "message" text null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "tbank_notification_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_tbank_notification_deleted_at" ON "tbank_notification" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_tbank_notification_payment_id_status_unique" ON "tbank_notification" ("payment_id", "status") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_tbank_notification_order_id" ON "tbank_notification" ("order_id") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "tbank_notification" cascade;`);
  }

}
