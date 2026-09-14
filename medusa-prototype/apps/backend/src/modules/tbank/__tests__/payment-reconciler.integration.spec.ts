import { Client } from "pg";
import { Migration20260726153050 } from "../../tbank-notifications/migrations/Migration20260726153050";
import { Migration20260909120000 } from "../../tbank-notifications/migrations/Migration20260909120000";
import TbankNotificationModuleService from "../../tbank-notifications/service";
import {
  PaymentReconcilerService,
  type TbankNotificationStore,
} from "../services/payment-reconciler";

const DATABASE_URL = process.env.TBANK_INBOX_TEST_DATABASE_URL;
const describePostgres = DATABASE_URL ? describe : describe.skip;
const TEST_LOGGER = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
} as const;

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

async function applyQueries(
  client: Client,
  migration: Migration20260726153050 | Migration20260909120000,
): Promise<void> {
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

function createNotificationStore(client: Client): TbankNotificationStore {
  const manager = queryManager(client);
  return {
    quarantineExpiredExhausted: (input) =>
      TbankNotificationModuleService.prototype.quarantineExpiredExhausted.call(
        {},
        input,
        { manager } as never,
      ),
    claimNotificationById: (input) =>
      TbankNotificationModuleService.prototype.claimNotificationById.call(
        {},
        input,
        { manager } as never,
      ),
    claimInbox: (input) =>
      TbankNotificationModuleService.prototype.claimInbox.call(
        {},
        input,
        { manager } as never,
      ),
    renewInboxLease: (input) =>
      TbankNotificationModuleService.prototype.renewInboxLease.call(
        {},
        input,
        { manager } as never,
      ),
    completeInbox: (input) =>
      TbankNotificationModuleService.prototype.completeInbox.call(
        {},
        input,
        { manager } as never,
      ),
    failInbox: (input) =>
      TbankNotificationModuleService.prototype.failInbox.call(
        {},
        input,
        { manager } as never,
      ),
    quarantineConflict: (input) =>
      TbankNotificationModuleService.prototype.quarantineConflict.call(
        {},
        input,
        { manager } as never,
      ),
    retryManualReview: (input) =>
      TbankNotificationModuleService.prototype.retryManualReview.call(
        {},
        input,
        { manager } as never,
      ),
    resolveManualReview: (input) =>
      TbankNotificationModuleService.prototype.resolveManualReview.call(
        {},
        input,
        { manager } as never,
      ),
    listTbankNotifications: async (filters: Record<string, unknown>) => {
      const conditions: string[] = [];
      const values: unknown[] = [];
      let i = 1;
      for (const [key, val] of Object.entries(filters)) {
        conditions.push(`"${key}" = $${i++}`);
        values.push(val);
      }
      const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
      const res = await client.query(`SELECT * FROM tbank_notification ${where}`, values);
      return res.rows;
    },
    listTbankPaymentAttempts: async (filters: Record<string, unknown>) => {
      const conditions: string[] = [];
      const values: unknown[] = [];
      let i = 1;
      for (const [key, val] of Object.entries(filters)) {
        conditions.push(`"${key}" = $${i++}`);
        values.push(val);
      }
      const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
      const res = await client.query(`SELECT * FROM tbank_payment_attempt ${where}`, values);
      return res.rows;
    },
    listTbankNotificationConflicts: async (filters: Record<string, unknown>) => {
      const conditions: string[] = [];
      const values: unknown[] = [];
      let i = 1;
      for (const [key, val] of Object.entries(filters)) {
        conditions.push(`"${key}" = $${i++}`);
        values.push(val);
      }
      const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
      const res = await client.query(`SELECT * FROM tbank_notification_conflict ${where}`, values);
      return res.rows;
    },
  };
}

describePostgres("PaymentReconcilerService PostgreSQL integration", () => {
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
    while (clients.length > 0) {
      const client = clients.pop();
      if (client) await client.end();
    }
  });

  it("recovers from crash before projection and projects exactly once", async () => {
    // Seed confirmed notification
    await database.query(
      `INSERT INTO tbank_notification
        (id, terminal_key, payment_id, status, order_id, amount_kopecks, currency_code,
         success, canonical_payload_hash, lifecycle_state, attempt_count)
       VALUES ('tbnotif_rec_1', 'term', 'pay_rec_1', 'CONFIRMED', 'payses_rec_1', 10000, 'rub', true, repeat('1', 64), 'pending', 0)`,
    );

    let projectionsCount = 0;
    const mockWorkflowRunner = jest.fn().mockImplementation(async () => {
      projectionsCount++;
      return { errors: [], result: { id: "order_1" } };
    });

    const mockPaymentService: any = {
      retrievePaymentSession: jest.fn().mockResolvedValue({
        id: "payses_rec_1",
        amount: 100,
        currency_code: "rub",
        provider_id: "pp_tbank_tbank",
        status: "pending",
        data: { paymentId: "pay_rec_1", orderId: "payses_rec_1" },
      }),
      updatePaymentSession: jest.fn().mockResolvedValue({}),
    };

    const notificationStore = createNotificationStore(database);
    const durableLinkageChecker = jest.fn().mockImplementation(async () => ({
      orderLinked: projectionsCount > 0,
      paymentCaptured: projectionsCount > 0,
    }));

    const reconciler = new PaymentReconcilerService({
      logger: TEST_LOGGER,
      notifications: notificationStore,
      payment: mockPaymentService,
      expectedTerminalKey: "term",
      workflowRunner: mockWorkflowRunner,
      durableLinkageChecker,
    });

    // Run batch recovery
    const batchResult = await reconciler.processPendingBatch(10);
    expect(batchResult.claimed).toBe(1);
    expect(batchResult.results[0].status).toBe("processed");
    expect(projectionsCount).toBe(1);

    // Verify row is marked processed in PostgreSQL
    const res = await database.query(
      "SELECT lifecycle_state, processed_at FROM tbank_notification WHERE id = 'tbnotif_rec_1'",
    );
    expect(res.rows[0].lifecycle_state).toBe("processed");
    expect(res.rows[0].processed_at).not.toBeNull();

    // Re-run batch recovery: zero claimable rows, no redundant projection
    const reRun = await reconciler.processPendingBatch(10);
    expect(reRun.claimed).toBe(0);
    expect(projectionsCount).toBe(1);
  });

  it("replay barrier: completes inbox without re-executing workflow if order already exists", async () => {
    await database.query(
      `INSERT INTO tbank_notification
        (id, terminal_key, payment_id, status, order_id, amount_kopecks, currency_code,
         success, canonical_payload_hash, lifecycle_state, attempt_count)
       VALUES ('tbnotif_replay', 'term', 'pay_replay', 'CONFIRMED', 'payses_replay', 10000, 'rub', true, repeat('2', 64), 'pending', 0)`,
    );

    const mockWorkflowRunner = jest.fn();
    const mockPaymentService: any = {
      retrievePaymentSession: jest.fn().mockResolvedValue({
        id: "payses_replay",
        amount: 100,
        currency_code: "rub",
        provider_id: "pp_tbank_tbank",
        status: "captured", // Already captured in Medusa
        data: { paymentId: "pay_replay", orderId: "payses_replay" },
      }),
      updatePaymentSession: jest.fn().mockResolvedValue({}),
    };

    const durableLinkageChecker = jest.fn().mockResolvedValue({
      orderLinked: true,
      orderId: "order_existing_123",
      paymentCaptured: true,
    });

    const reconciler = new PaymentReconcilerService({
      logger: TEST_LOGGER,
      notifications: createNotificationStore(database),
      payment: mockPaymentService,
      expectedTerminalKey: "term",
      workflowRunner: mockWorkflowRunner,
      durableLinkageChecker,
    });

    const result = await reconciler.processNotification("tbnotif_replay");
    expect(result.status).toBe("processed");
    expect(result).toHaveProperty("action", "already_captured");
    expect(mockWorkflowRunner).not.toHaveBeenCalled();

    // Row is marked processed in PostgreSQL
    const res = await database.query(
      "SELECT lifecycle_state, processed_at FROM tbank_notification WHERE id = 'tbnotif_replay'",
    );
    expect(res.rows[0].lifecycle_state).toBe("processed");
  });

  it("schedules a retry when capture succeeds before order linkage", async () => {
    await database.query(
      `INSERT INTO tbank_notification
        (id, terminal_key, payment_id, status, order_id, amount_kopecks, currency_code,
         success, canonical_payload_hash, lifecycle_state, attempt_count)
       VALUES ('tbnotif_silent_fail', 'term', 'pay_silent', 'CONFIRMED', 'payses_silent', 10000, 'rub', true, repeat('3', 64), 'pending', 0)`,
    );

    const mockWorkflowRunner = jest.fn().mockResolvedValue({ errors: [], result: {} });
    const mockPaymentService: any = {
      retrievePaymentSession: jest.fn().mockResolvedValue({
        id: "payses_silent",
        amount: 100,
        currency_code: "rub",
        provider_id: "pp_tbank_tbank",
        status: "pending",
        data: { paymentId: "pay_silent", orderId: "payses_silent" },
      }),
      updatePaymentSession: jest.fn().mockResolvedValue({}),
    };

    // Pre-check: not linked. Post-check: payment captured, but order NOT linked!
    const durableLinkageChecker = jest
      .fn()
      .mockResolvedValueOnce({ orderLinked: false, paymentCaptured: false })
      .mockResolvedValueOnce({ orderLinked: false, paymentCaptured: true });

    const reconciler = new PaymentReconcilerService({
      logger: TEST_LOGGER,
      notifications: createNotificationStore(database),
      payment: mockPaymentService,
      expectedTerminalKey: "term",
      workflowRunner: mockWorkflowRunner,
      durableLinkageChecker,
    });

    const result = await reconciler.processNotification("tbnotif_silent_fail");
    expect(result.status).toBe("retry_scheduled");

    // Row remains retryable because durable order linkage can still converge.
    const res = await database.query(
      "SELECT lifecycle_state, next_attempt_at FROM tbank_notification WHERE id = 'tbnotif_silent_fail'",
    );
    expect(res.rows[0].lifecycle_state).toBe("pending");
    expect(res.rows[0].next_attempt_at).not.toBeNull();
  });

  it("fences stale worker whose lease expired during execution", async () => {
    await database.query(
      `INSERT INTO tbank_notification
        (id, terminal_key, payment_id, status, order_id, amount_kopecks, currency_code,
         success, canonical_payload_hash, lifecycle_state, attempt_count)
       VALUES ('tbnotif_fence', 'term', 'pay_fence', 'CONFIRMED', 'payses_fence', 10000, 'rub', true, repeat('4', 64), 'pending', 0)`,
    );

    const mockPaymentService: any = {
      retrievePaymentSession: jest.fn().mockResolvedValue({
        id: "payses_fence",
        amount: 100,
        currency_code: "rub",
        provider_id: "pp_tbank_tbank",
        status: "pending",
        data: { paymentId: "pay_fence", orderId: "payses_fence" },
      }),
      updatePaymentSession: jest.fn().mockResolvedValue({}),
    };

    // Simulate worker 1 claiming row at T0
    const worker1Lease = "lease_worker_1";
    const t0 = new Date("2026-09-10T12:00:00.000Z");
    await TbankNotificationModuleService.prototype.claimNotificationById.call(
      {},
      { id: "tbnotif_fence", leaseToken: worker1Lease, now: t0 },
      { manager: queryManager(database) } as never,
    );

    // Time advances past lease expiration (61 seconds)
    const tAfterExpiry = new Date("2026-09-10T12:01:02.000Z");

    // Worker 2 (recovery) claims the expired row
    const worker2Lease = "lease_worker_2";
    const reclaimed = await TbankNotificationModuleService.prototype.claimInbox.call(
      {},
      { limit: 1, leaseToken: worker2Lease, now: tAfterExpiry },
      { manager: queryManager(database) } as never,
    );
    expect(reclaimed).toHaveLength(1);
    expect(reclaimed[0]).toEqual(expect.objectContaining({ lease_token: worker2Lease }));

    // Worker 1 now attempts to complete with its stale lease
    const staleCompletion = await TbankNotificationModuleService.prototype.completeInbox.call(
      {},
      { id: "tbnotif_fence", leaseToken: worker1Lease, now: tAfterExpiry },
      { manager: queryManager(database) } as never,
    );

    // Zero rows affected: worker 1 was successfully fenced!
    expect(staleCompletion).toHaveLength(0);

    // Row in DB still belongs to worker 2 and is leased
    const check = await database.query(
      "SELECT lifecycle_state, lease_token FROM tbank_notification WHERE id = 'tbnotif_fence'",
    );
    expect(check.rows[0].lifecycle_state).toBe("leased");
    expect(check.rows[0].lease_token).toBe(worker2Lease);
  });

  it("audits operator retry and resolve actions in database", async () => {
    await database.query(
      `INSERT INTO tbank_notification
        (id, terminal_key, payment_id, status, order_id, amount_kopecks, currency_code,
         success, canonical_payload_hash, lifecycle_state, attempt_count)
       VALUES ('tbnotif_audit', 'term', 'pay_audit', 'CONFIRMED', 'payses_audit', 10000, 'rub', true, repeat('5', 64), 'manual_review', 5)`,
    );

    const mockPaymentService: any = {
      retrievePaymentSession: jest.fn(),
    };

    const reconciler = new PaymentReconcilerService({
      logger: TEST_LOGGER,
      notifications: createNotificationStore(database),
      payment: mockPaymentService,
      expectedTerminalKey: "term",
    });

    // 1. Operator retries
    await reconciler.retryManualReview("tbnotif_audit", {
      operatorId: "op_carol",
      reason: "Verified network connectivity",
    });

    // Verify row is back to pending and conflict audit was inserted
    const afterRetry = await database.query(
      "SELECT lifecycle_state, attempt_count FROM tbank_notification WHERE id = 'tbnotif_audit'",
    );
    expect(afterRetry.rows[0].lifecycle_state).toBe("pending");
    expect(afterRetry.rows[0].attempt_count).toBe(0);

    const retryConflicts = await database.query(
      "SELECT conflict_kind, correlation_failures FROM tbank_notification_conflict WHERE canonical_notification_id = 'tbnotif_audit' AND conflict_kind = 'operator_retry'",
    );
    expect(retryConflicts.rows).toHaveLength(1);
    expect(retryConflicts.rows[0].correlation_failures).toContain("op_carol");

    // Move back to manual_review to test resolve
    await database.query(
      "UPDATE tbank_notification SET lifecycle_state = 'manual_review' WHERE id = 'tbnotif_audit'",
    );

    // 2. Operator resolves
    await reconciler.resolveManualReview("tbnotif_audit", {
      operatorId: "op_dave",
      reason: "Confirmed payment manually in banking dashboard",
    });

    const afterResolve = await database.query(
      "SELECT lifecycle_state, processed_at FROM tbank_notification WHERE id = 'tbnotif_audit'",
    );
    expect(afterResolve.rows[0].lifecycle_state).toBe("processed");
    expect(afterResolve.rows[0].processed_at).not.toBeNull();

    const resolveConflicts = await database.query(
      "SELECT conflict_kind, correlation_failures FROM tbank_notification_conflict WHERE canonical_notification_id = 'tbnotif_audit' AND conflict_kind = 'operator_resolve'",
    );
    expect(resolveConflicts.rows).toHaveLength(1);
    expect(resolveConflicts.rows[0].correlation_failures).toContain("op_dave");
  });
});
