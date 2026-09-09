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
    expect(sql).toContain('"terminal_key", "payment_id", "status"');
  });

  it("retains payment evidence when application code is rolled back", async () => {
    const migration = new Migration20260909120000({} as never, {} as never);

    await migration.down();

    expect(migration.getQueries()).toEqual([]);
  });
});
