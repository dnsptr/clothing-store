import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20261107130000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`create table "checkout_hold" (
      "id" text not null,
      "payment_session_id" text not null,
      "cart_id" text not null,
      "allocations" jsonb not null,
      "state" text not null default 'active' check ("state" in ('active', 'settling', 'consumed', 'released', 'expired')),
      "expires_at" timestamptz not null,
      "created_at" timestamptz not null default now(),
      "updated_at" timestamptz not null default now(),
      "deleted_at" timestamptz null,
      constraint "checkout_hold_pkey" primary key ("id")
    );`);
    this.addSql(`create unique index "IDX_checkout_hold_payment_session_id_unique" on "checkout_hold" ("payment_session_id") where "deleted_at" is null;`);
    this.addSql(`create index "IDX_checkout_hold_state_expires_at" on "checkout_hold" ("state", "expires_at") where "deleted_at" is null;`);
    this.addSql(`create index "IDX_checkout_hold_cart_id" on "checkout_hold" ("cart_id") where "deleted_at" is null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "checkout_hold";`);
  }
}
