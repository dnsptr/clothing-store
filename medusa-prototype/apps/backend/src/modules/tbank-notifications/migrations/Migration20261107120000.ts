import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20261107120000 extends Migration {
  override async up(): Promise<void> {
    // Historical zero amounts cannot distinguish omission from an explicit zero.
    // Keep them subject to strict correlation rather than guessing bank evidence.
    this.addSql(`alter table "tbank_notification" add column "amount_provided" boolean not null default true;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "tbank_notification" drop column "amount_provided";`);
  }
}
