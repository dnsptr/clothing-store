import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20261011210328 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "cart_access" drop constraint if exists "cart_access_cart_id_unique";`);
    this.addSql(`create table if not exists "cart_access" ("id" text not null, "cart_id" text not null, "token_digest" text not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "cart_access_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_cart_access_deleted_at" ON "cart_access" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_cart_access_cart_id_unique" ON "cart_access" ("cart_id") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "cart_access" cascade;`);
  }

}
