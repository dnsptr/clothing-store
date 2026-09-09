import { randomUUID } from "node:crypto";

import { Client } from "pg";

import { Migration20260726153050 } from "../../../../../modules/tbank-notifications/migrations/Migration20260726153050";
import { Migration20260909120000 } from "../../../../../modules/tbank-notifications/migrations/Migration20260909120000";
import { generateToken } from "../../../../../modules/tbank/lib/token";
import { POST } from "../route";

const DATABASE_URL = process.env.TBANK_INBOX_TEST_DATABASE_URL;
const describePostgres = DATABASE_URL ? describe : describe.skip;
const PASSWORD = "TinkoffBankTest";
const TERMINAL = "TinkoffBankTest";
const SESSION = {
  id: "payses_01JABCDEF",
  provider_id: "pp_tbank_tbank",
  currency_code: "rub",
  amount: 18990,
  data: { paymentId: "3456789", orderId: "payses_01JABCDEF", status: "NEW" },
};

async function applyMigration(client: Client, migration: Migration20260726153050 | Migration20260909120000) {
  for (const query of migration.getQueries()) {
    if (typeof query !== "string") throw new TypeError("Test migration contains a non-string query");
    await client.query(query);
  }
}

function signed(overrides: Readonly<Record<string, unknown>> = {}) {
  const body: Record<string, unknown> = {
    TerminalKey: TERMINAL,
    OrderId: SESSION.id,
    PaymentId: 3456789,
    Status: "CONFIRMED",
    Amount: 1899000,
    Success: true,
    ...overrides,
  };
  body.Token = generateToken(body, PASSWORD);
  return body;
}

function response() {
  const result = { statusCode: 200, body: undefined as unknown, status: jest.fn(), send: jest.fn() };
  result.status.mockImplementation((statusCode: number) => {
    result.statusCode = statusCode;
    return result;
  });
  result.send.mockImplementation((body: unknown) => {
    result.body = body;
    return result;
  });
  return result;
}

function postgresStore(client: Client) {
  return {
    async listTbankNotifications(filters: Record<string, string>) {
      const result = await client.query(
        `SELECT id, canonical_payload_hash FROM tbank_notification
         WHERE terminal_key = $1 AND payment_id = $2 AND status = $3 AND deleted_at IS NULL`,
        [filters.terminal_key, filters.payment_id, filters.status],
      );
      return result.rows;
    },
    async createTbankNotifications(data: Record<string, unknown>) {
      const result = await client.query(
        `INSERT INTO tbank_notification
          (id, terminal_key, payment_id, order_id, amount_kopecks, currency_code, success,
           status, canonical_payload_hash, lifecycle_state, attempt_count)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
        [
          `tbnotif_${randomUUID()}`,
          data.terminal_key,
          data.payment_id,
          data.order_id,
          data.amount_kopecks,
          data.currency_code,
          data.success,
          data.status,
          data.canonical_payload_hash,
          data.lifecycle_state,
          data.attempt_count,
        ],
      );
      return result.rows[0];
    },
    async createTbankNotificationConflicts(data: Record<string, unknown>) {
      const result = await client.query(
        `INSERT INTO tbank_notification_conflict
          (id, canonical_notification_id, terminal_key, payment_id, status, canonical_payload_hash,
           conflicting_payload_hash, conflict_kind, correlation_failures, lifecycle_state)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'manual_review') RETURNING id`,
        [
          `tbconf_${randomUUID()}`,
          data.canonical_notification_id,
          data.terminal_key,
          data.payment_id,
          data.status,
          data.canonical_payload_hash,
          data.conflicting_payload_hash,
          data.conflict_kind,
          data.correlation_failures,
        ],
      );
      return result.rows[0];
    },
  };
}

function request(body: Record<string, unknown>, store: ReturnType<typeof postgresStore>, events: jest.Mock) {
  return {
    body,
    scope: {
      resolve: (key: string) => {
        if (key === "logger") return { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
        if (key === "tbankNotification") return store;
        if (key === "payment") return { retrievePaymentSession: jest.fn().mockResolvedValue(SESSION) };
        return { emit: events };
      },
    },
  } as never;
}

describePostgres("T-Bank webhook PostgreSQL persistence", () => {
  let database: Client;

  beforeAll(() => {
    Object.assign(process.env, {
      TBANK_ENABLED: "true",
      TBANK_PAYMENT_PROVIDER_ID: "pp_tbank_tbank",
      TBANK_TERMINAL_KEY: TERMINAL,
      TBANK_PASSWORD: PASSWORD,
      TBANK_API_BASE_URL: "https://rest-api-test.tinkoff.ru/v2",
      TBANK_SUCCESS_URL: "https://mariomikke.shop/checkout/success",
      TBANK_FAIL_URL: "https://mariomikke.shop/checkout/fail",
      TBANK_NOTIFICATION_URL: "https://api.mariomikke.shop/hooks/payment/tbank",
    });
  });

  beforeEach(async () => {
    database = new Client({ connectionString: DATABASE_URL });
    await database.connect();
    await database.query('drop table if exists "tbank_notification_conflict" cascade');
    await database.query('drop table if exists "tbank_payment_attempt" cascade');
    await database.query('drop table if exists "tbank_notification" cascade');
    await database.query('drop function if exists "tbank_payment_attempt_immutable_correlation"()');
    await database.query('drop function if exists reject_tbank_conflict()');
    const baseline = new Migration20260726153050({} as never, {} as never);
    await baseline.up();
    await applyMigration(database, baseline);
    const inbox = new Migration20260909120000({} as never, {} as never);
    await inbox.up();
    await applyMigration(database, inbox);
  });

  afterEach(() => database.end());

  it("writes nothing and emits nothing for an invalid signature", async () => {
    const events = jest.fn();
    const result = response();
    await POST(request({ ...signed(), Token: "invalid" }, postgresStore(database), events), result as never);
    const rows = await database.query(
      `SELECT (SELECT count(*)::int FROM tbank_notification) AS inbox,
              (SELECT count(*)::int FROM tbank_notification_conflict) AS conflicts`,
    );
    expect(result.statusCode).toBe(401);
    expect(rows.rows[0]).toEqual({ inbox: 0, conflicts: 0 });
    expect(events).not.toHaveBeenCalled();
  });

  it("persists a correlated fact, mismatch audit, and identical dedupe without events", async () => {
    const events = jest.fn();
    const store = postgresStore(database);
    const first = response();
    await POST(request(signed(), store, events), first as never);
    await POST(request(signed(), store, events), response() as never);
    await POST(request(signed({ Amount: 1 }), store, events), response() as never);
    const rows = await database.query(
      `SELECT (SELECT count(*)::int FROM tbank_notification) AS inbox,
              (SELECT count(*)::int FROM tbank_notification_conflict) AS conflicts`,
    );
    expect(first.body).toBe("OK");
    expect(rows.rows[0]).toEqual({ inbox: 1, conflicts: 1 });
    expect(events).not.toHaveBeenCalled();
  });

  it("turns a changed canonical duplicate race into one inbox row and one conflict", async () => {
    const firstClient = new Client({ connectionString: DATABASE_URL });
    const secondClient = new Client({ connectionString: DATABASE_URL });
    await Promise.all([firstClient.connect(), secondClient.connect()]);
    try {
      const first = response();
      const second = response();
      await Promise.all([
        POST(request(signed({ Message: "first" }), postgresStore(firstClient), jest.fn()), first as never),
        POST(request(signed({ Message: "second" }), postgresStore(secondClient), jest.fn()), second as never),
      ]);
      const rows = await database.query(
        `SELECT (SELECT count(*)::int FROM tbank_notification) AS inbox,
                (SELECT count(*)::int FROM tbank_notification_conflict) AS conflicts`,
      );
      expect([first.body, second.body]).toEqual(["OK", "OK"]);
      expect(rows.rows[0]).toEqual({ inbox: 1, conflicts: 1 });
    } finally {
      await Promise.all([firstClient.end(), secondClient.end()]);
    }
  });

  it("does not acknowledge when PostgreSQL refuses the conflict write", async () => {
    await database.query(`create function reject_tbank_conflict() returns trigger language plpgsql as $$ begin raise exception 'conflict store unavailable'; end $$`);
    await database.query(`create trigger reject_tbank_conflict before insert on tbank_notification_conflict for each row execute function reject_tbank_conflict()`);
    const result = response();
    await POST(request(signed({ Amount: 1 }), postgresStore(database), jest.fn()), result as never);
    const rows = await database.query(`SELECT count(*)::int AS inbox FROM tbank_notification`);
    expect(result.statusCode).toBe(500);
    expect(result.body).not.toBe("OK");
    expect(rows.rows[0].inbox).toBe(0);
  });
});
