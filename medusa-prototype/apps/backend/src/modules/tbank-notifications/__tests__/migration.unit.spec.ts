import { Migration20260909120000 } from "../migrations/Migration20260909120000";

describe("T-Bank notification inbox migration", () => {
  it("creates durable lifecycle, lease, retry, hash, and conflict storage", async () => {
    const migration = new Migration20260909120000({} as never, {} as never);

    await migration.up();
    const sql = migration.getQueries().join("\n");

    expect(sql).toContain('"canonical_payload_hash" text');
    expect(sql).toContain('"lifecycle_state" text');
    expect(sql).toContain('"lease_expires_at" timestamptz');
    expect(sql).toContain('"last_error_at" timestamptz');
    expect(sql).toContain('"attempt_count" between 0 and 5');
    expect(sql).toContain('create table "tbank_notification_conflict"');
    expect(sql).toContain('create table "tbank_payment_attempt"');
    expect(sql).toContain('"payment_attempt_id" text');
    expect(sql).toContain('references "tbank_payment_attempt" ("id")');
    expect(sql).toContain('"terminal_key", "payment_id", "status"');
    expect(sql).toContain('"IDX_tbank_notification_conflict_payment_id_status"');
  });

  it("restores the previous schema so rollback can be reapplied safely", async () => {
    const migration = new Migration20260909120000({} as never, {} as never);

    await migration.down();
    const sql = migration.getQueries().join("\n");

    expect(sql).toContain('drop table if exists "tbank_notification_conflict"');
    expect(sql).toContain("cannot rollback T-Bank inbox: duplicate legacy payment/status rows");
    expect(sql).toContain('drop table if exists "tbank_payment_attempt"');
    expect(sql).toContain('drop constraint if exists "CHK_tbank_notification_lifecycle"');
    expect(sql).toContain('drop column if exists "terminal_key"');
    expect(sql).toContain('"IDX_tbank_notification_payment_id_status_unique"');
  });
});
