import { Client } from "pg";
import { Migration20260726153050 } from "../../tbank-notifications/migrations/Migration20260726153050";
import { Migration20260909120000 } from "../../tbank-notifications/migrations/Migration20260909120000";
import TbankNotificationModuleService from "../../tbank-notifications/service";
import { PaymentReconcilerService } from "../services/payment-reconciler";

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

describePostgres("PaymentReconcilerService PostgreSQL integration", () => {
  const clients: Client[] = [];
  let database: Client;
  let notificationService: TbankNotificationModuleService;

  async function connect(): Promise<Client> {
    const client = new Client({ connectionString: DATABASE_URL });
    await client.connect();
    clients.push(client);
    return client;
  }

  beforeEach(async () => {
    database = await connect();
    await rebuildSchema(database);
    notificationService = new TbankNotificationModuleService();
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
        status: "pending",
        data: {},
      }),
      updatePaymentSession: jest.fn().mockResolvedValue({}),
    };

    const serviceWithManager = {
      claimInbox: (input: any) =>
        notificationService.claimInbox(input, { manager: queryManager(database) as any }),
      claimNotificationById: (input: any) =>
        notificationService.claimNotificationById(input, { manager: queryManager(database) as any }),
      completeInbox: (input: any) =>
        notificationService.completeInbox(input, { manager: queryManager(database) as any }),
      failInbox: (input: any) =>
        notificationService.failInbox(input, { manager: queryManager(database) as any }),
      quarantineManualReview: (input: any) =>
        notificationService.quarantineManualReview(input, { manager: queryManager(database) as any }),
      retryManualReview: (input: any) =>
        notificationService.retryManualReview(input, { manager: queryManager(database) as any }),
      resolveManualReview: (input: any) =>
        notificationService.resolveManualReview(input, { manager: queryManager(database) as any }),
      listTbankNotifications: async (filters: any) => {
        const rows = await database.query("SELECT * FROM tbank_notification WHERE id = $1", [filters.id]);
        return rows.rows;
      },
    };

    const reconciler = new PaymentReconcilerService({
      notifications: serviceWithManager as any,
      payment: mockPaymentService,
      workflowRunner: mockWorkflowRunner,
    });

    // Run batch recovery
    const batchResult = await reconciler.processPendingBatch(10);
    expect(batchResult.claimed).toBe(1);
    expect(batchResult.results[0].status).toBe("processed");
    expect(projectionsCount).toBe(1);

    // Verify row is marked processed in PostgreSQL
    const res = await database.query("SELECT lifecycle_state, processed_at FROM tbank_notification WHERE id = 'tbnotif_rec_1'");
    expect(res.rows[0].lifecycle_state).toBe("processed");
    expect(res.rows[0].processed_at).not.toBeNull();

    // Re-run batch recovery: zero claimable rows, no redundant projection
    const reRun = await reconciler.processPendingBatch(10);
    expect(reRun.claimed).toBe(0);
    expect(projectionsCount).toBe(1);
  });
});
