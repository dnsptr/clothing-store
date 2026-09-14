import { Client } from "pg";

import { Migration20260726153050 } from "../migrations/Migration20260726153050";
import { Migration20260909120000 } from "../migrations/Migration20260909120000";
import TbankNotificationModuleService from "../service";

const DATABASE_URL = process.env.TBANK_INBOX_TEST_DATABASE_URL;
const describePostgres = DATABASE_URL ? describe : describe.skip;

function postgresSql(sql: string): string {
  let parameter = 0;
  return sql.replaceAll("?", () => `$${++parameter}`);
}

function queryManager(client: Client) {
  return {
    execute: async (sql: string, parameters: readonly unknown[]) => {
      const result = await client.query(postgresSql(sql), Array.from(parameters));
      return result.rows;
    },
  };
}

async function applyQueries(client: Client, migration: Migration20260726153050 | Migration20260909120000): Promise<void> {
  for (const query of migration.getQueries()) {
    if (typeof query !== "string") throw new TypeError("Test migration contains a non-string query");
    await client.query(query);
  }
}

async function rebuildSchema(client: Client): Promise<void> {
  await client.query('drop table if exists "tbank_notification_conflict" cascade');
  await client.query('drop table if exists "tbank_payment_attempt" cascade');
  await client.query('drop table if exists "tbank_notification" cascade');
  await client.query('drop function if exists "tbank_payment_attempt_immutable_correlation"()');
  const baseline = new Migration20260726153050({} as never, {} as never);
  await baseline.up();
  await applyQueries(client, baseline);
  const inbox = new Migration20260909120000({} as never, {} as never);
  await inbox.up();
  await applyQueries(client, inbox);
}

async function insertPending(client: Client, id: string): Promise<void> {
  await client.query(
    `INSERT INTO tbank_notification
      (id, terminal_key, payment_id, status, order_id, amount_kopecks, currency_code,
       success, canonical_payload_hash, lifecycle_state, attempt_count)
     VALUES ($1, 'terminal', $1, 'CONFIRMED', $1, 100, 'rub', true, repeat('a', 64), 'pending', 0)`,
    [id],
  );
}

describePostgres("T-Bank inbox PostgreSQL persistence", () => {
  const clients: Client[] = [];
  let database: Client;

  async function connect(): Promise<Client> {
    const client = new Client({ connectionString: DATABASE_URL });
    await client.connect();
    clients.push(client);
    return client;
  }

  beforeEach(async () => {
    database = await connect();
    await rebuildSchema(database);
  });

  afterEach(async () => {
    await Promise.all(clients.splice(0).map((client) => client.end()));
  });

  it("applies, rolls back, and reapplies with snapshot-compatible index names", async () => {
    await database.query(
      `INSERT INTO tbank_payment_attempt
        (id, payment_session_id, provider_id, terminal_key, order_id, expected_amount_kopecks, currency_code)
       VALUES ('attempt-1', 'session-1', 'pp_tbank_tbank', 'terminal', 'order-1', 100, 'rub')`,
    );
    await database.query(
      `INSERT INTO tbank_notification
        (id, payment_attempt_id, terminal_key, payment_id, status, order_id, amount_kopecks,
         currency_code, success, canonical_payload_hash, lifecycle_state, attempt_count)
       VALUES ('related', 'attempt-1', 'terminal', 'payment-1', 'CONFIRMED', 'order-1',
               100, 'rub', true, repeat('a', 64), 'pending', 0)`,
    );
    await expect(database.query(
      `UPDATE tbank_payment_attempt SET expected_amount_kopecks = 200 WHERE id = 'attempt-1'`,
    )).rejects.toThrow("T-Bank payment attempt correlation fields are immutable");

    const migration = new Migration20260909120000({} as never, {} as never);
    await migration.down();
    await applyQueries(database, migration);

    const rolledBack = await database.query(
      `SELECT to_regclass('public."IDX_tbank_notification_payment_id_status_unique"') AS old_index,
              to_regclass('public.tbank_notification_conflict') AS conflict_table`,
    );
    expect(rolledBack.rows[0]).toEqual(expect.objectContaining({
      old_index: '"IDX_tbank_notification_payment_id_status_unique"',
      conflict_table: null,
    }));

    const reapplied = new Migration20260909120000({} as never, {} as never);
    await reapplied.up();
    await applyQueries(database, reapplied);
    const indexes = await database.query(
      `SELECT indexname FROM pg_indexes WHERE tablename IN ('tbank_notification', 'tbank_notification_conflict')`,
    );
    expect(indexes.rows.map((row) => row.indexname)).toEqual(expect.arrayContaining([
      "IDX_tbank_notification_terminal_key_payment_id_status_unique",
      "IDX_tbank_notification_conflict_payment_id_status",
    ]));
  });

  it("refuses rollback transactionally when legacy and redelivered rows collide", async () => {
    await database.query(
      `INSERT INTO tbank_notification
        (id, terminal_key, payment_id, status, order_id, amount_kopecks, currency_code,
         success, canonical_payload_hash, lifecycle_state, attempt_count)
       VALUES
        ('legacy-copy', 'legacy', 'same-payment', 'CONFIRMED', 'legacy-order', 100, 'rub', true, repeat('a', 64), 'processed', 0),
        ('redelivery', 'terminal', 'same-payment', 'CONFIRMED', 'new-order', 100, 'rub', true, repeat('b', 64), 'pending', 0)`,
    );
    const migration = new Migration20260909120000({} as never, {} as never);
    await migration.down();
    await database.query("BEGIN");

    await expect(applyQueries(database, migration)).rejects.toThrow(
      "cannot rollback T-Bank inbox: duplicate legacy payment/status rows",
    );
    await database.query("ROLLBACK");
    const preserved = await database.query(
      `SELECT count(*)::int AS rows, count(terminal_key)::int AS correlated_rows
       FROM tbank_notification WHERE payment_id = 'same-payment'`,
    );

    expect(preserved.rows[0]).toEqual({ rows: 2, correlated_rows: 2 });
  });

  it("gives competing claims different rows", async () => {
    await insertPending(database, "one");
    await insertPending(database, "two");
    const first = await connect();
    const second = await connect();
    const now = new Date("2026-09-09T12:00:00.000Z");

    const [firstRows, secondRows] = await Promise.all([
      TbankNotificationModuleService.prototype.claimInbox.call(
        {}, { limit: 1, leaseToken: "first", now }, { manager: queryManager(first) } as never,
      ),
      TbankNotificationModuleService.prototype.claimInbox.call(
        {}, { limit: 1, leaseToken: "second", now }, { manager: queryManager(second) } as never,
      ),
    ]);

    expect(new Set([...firstRows, ...secondRows].map((row) => row.id))).toEqual(new Set(["one", "two"]));
  });

  it("reclaims a crashed worker lease and rejects every stale owner mutation", async () => {
    await insertPending(database, "crash");
    const manager = queryManager(database);
    const claimedAt = new Date("2026-09-09T12:00:00.000Z");
    await TbankNotificationModuleService.prototype.claimInbox.call(
      {}, { limit: 1, leaseToken: "crashed", now: claimedAt }, { manager } as never,
    );
    const afterExpiry = new Date("2026-09-09T12:01:01.000Z");

    const expiredCompletion = await TbankNotificationModuleService.prototype.completeInbox.call(
      {}, { id: "crash", leaseToken: "crashed", now: afterExpiry }, { manager } as never,
    );
    const reclaimed = await TbankNotificationModuleService.prototype.claimInbox.call(
      {}, { limit: 1, leaseToken: "recovery", now: afterExpiry }, { manager } as never,
    );
    const staleFailure = await TbankNotificationModuleService.prototype.failInbox.call(
      {}, { id: "crash", leaseToken: "crashed", now: afterExpiry }, { manager } as never,
    );
    const staleRenewal = await TbankNotificationModuleService.prototype.renewInboxLease.call(
      {}, { id: "crash", leaseToken: "crashed", now: afterExpiry }, { manager } as never,
    );

    expect(expiredCompletion).toEqual([]);
    expect(reclaimed).toEqual([expect.objectContaining({ id: "crash", lease_token: "recovery", attempt_count: 2 })]);
    expect(staleFailure).toEqual([]);
    expect(staleRenewal).toEqual([]);
  });

  it("commits conflict audit and manual-review transition together for a valid lease", async () => {
    await insertPending(database, "atomic-success");
    const manager = queryManager(database);
    const now = new Date("2026-09-09T12:00:00.000Z");
    await TbankNotificationModuleService.prototype.claimNotificationById.call(
      {}, { id: "atomic-success", leaseToken: "owner", now }, { manager } as never,
    );

    const operation = Reflect.get(TbankNotificationModuleService.prototype, "quarantineConflict");
    if (typeof operation !== "function") throw new TypeError("quarantineConflict is unavailable");
    const rows = await Reflect.apply(operation, {}, [
      { id: "atomic-success", leaseToken: "owner", reason: "Correlation mismatch: amount", now },
      { manager },
    ]);

    const state = await database.query(
      `SELECT inbox.lifecycle_state, inbox.lease_token, count(conflict.id)::int AS conflicts
       FROM tbank_notification inbox
       LEFT JOIN tbank_notification_conflict conflict ON conflict.canonical_notification_id = inbox.id
       WHERE inbox.id = 'atomic-success'
       GROUP BY inbox.id`,
    );
    expect(rows).toHaveLength(1);
    expect(state.rows[0]).toEqual({ lifecycle_state: "manual_review", lease_token: null, conflicts: 1 });
  });

  it("inserts no conflict and preserves a reassigned lease for a stale owner", async () => {
    await insertPending(database, "atomic-stale");
    const manager = queryManager(database);
    const claimedAt = new Date("2026-09-09T12:00:00.000Z");
    await TbankNotificationModuleService.prototype.claimNotificationById.call(
      {}, { id: "atomic-stale", leaseToken: "old-owner", now: claimedAt }, { manager } as never,
    );
    const afterExpiry = new Date("2026-09-09T12:01:01.000Z");
    await TbankNotificationModuleService.prototype.claimInbox.call(
      {}, { limit: 1, leaseToken: "new-owner", now: afterExpiry }, { manager } as never,
    );

    const operation = Reflect.get(TbankNotificationModuleService.prototype, "quarantineConflict");
    if (typeof operation !== "function") throw new TypeError("quarantineConflict is unavailable");
    const rows = await Reflect.apply(operation, {}, [
      { id: "atomic-stale", leaseToken: "old-owner", reason: "Correlation mismatch: terminal", now: afterExpiry },
      { manager },
    ]);

    const state = await database.query(
      `SELECT inbox.lifecycle_state, inbox.lease_token, count(conflict.id)::int AS conflicts
       FROM tbank_notification inbox
       LEFT JOIN tbank_notification_conflict conflict ON conflict.canonical_notification_id = inbox.id
       WHERE inbox.id = 'atomic-stale'
       GROUP BY inbox.id`,
    );
    expect(rows).toEqual([]);
    expect(state.rows[0]).toEqual({ lifecycle_state: "leased", lease_token: "new-owner", conflicts: 0 });
  });

  it("rolls back the inbox transition when conflict insertion fails", async () => {
    await insertPending(database, "atomic-rollback");
    const manager = queryManager(database);
    const now = new Date("2026-09-09T12:00:00.000Z");
    await TbankNotificationModuleService.prototype.claimNotificationById.call(
      {}, { id: "atomic-rollback", leaseToken: "owner", now }, { manager } as never,
    );
    await database.query(
      `ALTER TABLE tbank_notification_conflict
       ADD CONSTRAINT reject_reconciler_conflict CHECK (conflict_kind <> 'correlation_mismatch')`,
    );

    const operation = Reflect.get(TbankNotificationModuleService.prototype, "quarantineConflict");
    if (typeof operation !== "function") throw new TypeError("quarantineConflict is unavailable");
    await expect(Reflect.apply(operation, {}, [
      { id: "atomic-rollback", leaseToken: "owner", reason: "Correlation mismatch: amount", now },
      { manager },
    ])).rejects.toThrow("reject_reconciler_conflict");

    const state = await database.query(
      `SELECT inbox.lifecycle_state, inbox.lease_token, count(conflict.id)::int AS conflicts
       FROM tbank_notification inbox
       LEFT JOIN tbank_notification_conflict conflict ON conflict.canonical_notification_id = inbox.id
       WHERE inbox.id = 'atomic-rollback'
       GROUP BY inbox.id`,
    );
    expect(state.rows[0]).toEqual({ lifecycle_state: "leased", lease_token: "owner", conflicts: 0 });
  });

  it("uses persisted attempts for exact backoff and moves the fifth failure to manual review", async () => {
    await insertPending(database, "retry");
    const manager = queryManager(database);
    let now = new Date("2026-09-09T12:00:00.000Z");
    const delays = [60_000, 300_000, 1_800_000, 7_200_000] as const;

    for (const [index, delay] of delays.entries()) {
      await TbankNotificationModuleService.prototype.claimInbox.call(
        {}, { limit: 1, leaseToken: `attempt-${index + 1}`, now }, { manager } as never,
      );
      const failed = await TbankNotificationModuleService.prototype.failInbox.call(
        {}, { id: "retry", leaseToken: `attempt-${index + 1}`, now }, { manager } as never,
      );
      expect(failed).toEqual([expect.objectContaining({
        attempt_count: index + 1,
        lifecycle_state: "pending",
        next_attempt_at: new Date(now.getTime() + delay),
      })]);
      now = new Date(now.getTime() + delay);
    }

    await TbankNotificationModuleService.prototype.claimInbox.call(
      {}, { limit: 1, leaseToken: "attempt-5", now }, { manager } as never,
    );
    const exhausted = await TbankNotificationModuleService.prototype.failInbox.call(
      {}, { id: "retry", leaseToken: "attempt-5", now }, { manager } as never,
    );

    expect(exhausted).toEqual([expect.objectContaining({
      attempt_count: 5,
      lifecycle_state: "manual_review",
      next_attempt_at: new Date(now.getTime() + 43_200_000),
    })]);
  });
});
