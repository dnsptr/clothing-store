import { randomUUID } from "node:crypto";
import { Client } from "pg";

import { Migration20261006120000 } from "../migrations/Migration20261006120000";

const DATABASE_URL = process.env.TBANK_INBOX_TEST_DATABASE_URL;
const describePostgres = DATABASE_URL ? describe : describe.skip;

async function migrate(client: Client, direction: "up" | "down"): Promise<void> {
  const migration = new Migration20261006120000({} as never, {} as never);
  await migration[direction]();
  for (const query of migration.getQueries()) {
    if (typeof query !== "string") throw new TypeError("Test migration contains a non-string query");
    await client.query(query);
  }
}

describePostgres("T-Bank fiscal journal PostgreSQL persistence", () => {
  let client: Client;
  let schema: string;

  beforeEach(async () => {
    client = new Client({ connectionString: DATABASE_URL });
    await client.connect();
    schema = `fiscal_test_${randomUUID().replaceAll("-", "")}`;
    await client.query(`create schema "${schema}"`);
    await client.query(`set search_path to "${schema}"`);
    await migrate(client, "up");
  });

  afterEach(async () => {
    try {
      await client.query(`drop schema "${schema}" cascade`);
    } finally {
      await client.end();
    }
  });

  it("keeps separate fiscal errors for the same payment/status and rejects active duplicate fingerprints", async () => {
    const insert = `insert into tbank_fiscal_notification
      (id, fingerprint, terminal_key, payment_id, order_id, status, receipt_type,
       success, amount_kopecks, error_code, error_message, review_reason, review_state)
      values ($1, $2, 'terminal', 'payment-1', 'order-1', 'CONFIRMED', 'Income',
              false, 100, $3, $4, $5, $6)`;
    await client.query(insert, ["first", "a".repeat(64), "42", "Fiscal device busy", "receipt_error", "manual_review"]);
    await client.query(insert, ["second", "b".repeat(64), "43", "Fiscal document rejected", "bank_error", "manual_review"]);

    const rows = await client.query(`select id, fingerprint, error_code, error_message, review_reason,
      review_state from tbank_fiscal_notification
      where terminal_key = 'terminal' and payment_id = 'payment-1' and status = 'CONFIRMED'
      order by id`);
    expect(rows.rows).toEqual([
      { id: "first", fingerprint: "a".repeat(64), error_code: "42", error_message: "Fiscal device busy", review_reason: "receipt_error", review_state: "manual_review" },
      { id: "second", fingerprint: "b".repeat(64), error_code: "43", error_message: "Fiscal document rejected", review_reason: "bank_error", review_state: "manual_review" },
    ]);
    await expect(client.query(insert, ["duplicate", "a".repeat(64), "44", "Other error", "other", "manual_review"]))
      .rejects.toMatchObject({ code: "23505", constraint: "IDX_tbank_fiscal_notification_fingerprint_unique" });

    await client.query(`insert into tbank_fiscal_notification (id, fingerprint, terminal_key, error_message)
      values ($1, $2, 'terminal', 'Uncorrelated fiscal callback')`, ["uncorrelated", "c".repeat(64)]);
    const uncorrelated = await client.query(`select payment_id, order_id, status, receipt_type, success,
      amount_kopecks, fn_number, fiscal_document_number, review_state, error_message
      from tbank_fiscal_notification
      where terminal_key = 'terminal' and payment_id is null and review_state = 'manual_review'`);
    expect(uncorrelated.rows).toEqual([{
      payment_id: null, order_id: null, status: null, receipt_type: null, success: null,
      amount_kopecks: null, fn_number: null, fiscal_document_number: null,
      review_state: "manual_review", error_message: "Uncorrelated fiscal callback",
    }]);
  });

  it("rolls back and reapplies without touching independent tables", async () => {
    await client.query(`create table unrelated_fiscal_test (id text primary key)`);
    await client.query(`insert into unrelated_fiscal_test (id) values ('preserve')`);
    await client.query(`insert into tbank_fiscal_notification (id, fingerprint, terminal_key)
      values ('original', $1, 'terminal')`, ["d".repeat(64)]);

    await migrate(client, "down");
    const dropped = await client.query(`select to_regclass('tbank_fiscal_notification') as journal,
      (select count(*)::int from unrelated_fiscal_test) as other_rows`);
    expect(dropped.rows[0]).toEqual({ journal: null, other_rows: 1 });

    await migrate(client, "up");
    await client.query(`insert into tbank_fiscal_notification (id, fingerprint, terminal_key)
      values ('reapplied', $1, 'terminal')`, ["d".repeat(64)]);
    const reapplied = await client.query(`select id, review_state from tbank_fiscal_notification`);
    expect(reapplied.rows).toEqual([{ id: "reapplied", review_state: "manual_review" }]);
    const preserved = await client.query(`select id from unrelated_fiscal_test`);
    expect(preserved.rows).toEqual([{ id: "preserve" }]);
  });
});
