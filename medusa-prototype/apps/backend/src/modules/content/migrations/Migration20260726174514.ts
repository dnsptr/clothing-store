import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260726174514 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "content_slide" ("id" text not null, "section" text check ("section" in ('hero', 'shortcut', 'material', 'store', 'promo')) not null, "rank" integer not null default 0, "is_active" boolean not null default true, "title" text not null, "eyebrow" text null, "subtitle" text null, "media_type" text check ("media_type" in ('image', 'video')) not null default 'image', "media_url" text not null, "media_key" text null, "poster_url" text null, "poster_key" text null, "alt" text null, "object_position" text null, "duration_ms" integer null, "href" text null, "cta_label" text null, "metadata" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "content_slide_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_content_slide_deleted_at" ON "content_slide" ("deleted_at") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "content_slide" cascade;`);
  }

}
