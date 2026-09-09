import {
  canonicalNotificationHash,
  correlateNotification,
  INBOX_LEASE_MS,
  MAX_INBOX_ATTEMPTS,
  RETRY_BACKOFF_MS,
  nextFailureState,
  toAuthenticatedNotification,
} from "../lifecycle";
import TbankNotificationModuleService, { InboxClaimLimitError } from "../service";
import { generateToken, verifyNotificationToken } from "../../tbank/lib/token";

const SESSION = {
  id: "payses_01JABCDEF",
  provider_id: "pp_tbank_tbank",
  currency_code: "rub",
  amount: 18990,
  data: { paymentId: "3456789", orderId: "payses_01JABCDEF" },
};

describe("T-Bank inbox lease and retry lifecycle", () => {
  it("canonicalizes bank numeric identifiers before hashing and excludes the token", () => {
    const numeric = { PaymentId: 123, Amount: 500, Token: "first", Status: "CONFIRMED" };
    const textual = { PaymentId: "123", Amount: "500", Token: "second", Status: "CONFIRMED" };

    expect(canonicalNotificationHash(numeric)).toBe(canonicalNotificationHash(textual));
  });

  it("keeps canonical identity independent from credential and unknown fields", () => {
    const password = "secret";
    const business = {
      TerminalKey: "terminal",
      OrderId: SESSION.id,
      PaymentId: 3456789,
      Status: "CONFIRMED",
      Amount: 1899000,
      Success: true,
    };
    const token = generateToken(business, password);
    const credentialInjection = { ...business, Token: token, Password: "injected" };
    const unknownInjection = { ...business, Token: token, Unrecognized: "injected" };

    expect(verifyNotificationToken(credentialInjection, password)).toBe(true);
    expect(verifyNotificationToken(unknownInjection, password)).toBe(false);
    expect(canonicalNotificationHash(credentialInjection)).toBe(canonicalNotificationHash(business));
    expect(canonicalNotificationHash(unknownInjection)).toBe(canonicalNotificationHash(business));
  });

  it("correlates an amount-less cancellation but rejects a provided wrong amount", () => {
    const cancellation = toAuthenticatedNotification({
      TerminalKey: "terminal",
      OrderId: SESSION.id,
      PaymentId: 3456789,
      Status: "CANCELED",
      Success: false,
    });
    const wrongAmount = toAuthenticatedNotification({
      TerminalKey: "terminal",
      OrderId: SESSION.id,
      PaymentId: 3456789,
      Status: "CANCELED",
      Success: false,
      Amount: 1,
    });

    expect(correlateNotification(cancellation, SESSION as never, "terminal")).toEqual({ kind: "correlated" });
    expect(correlateNotification(wrongAmount, SESSION as never, "terminal")).toEqual({ kind: "mismatch", fields: ["amount"] });
  });

  it.each([
    ["NEW", true],
    ["FORM_SHOWED", true],
    ["AUTHORIZING", true],
    ["3DS_CHECKING", true],
    ["AUTHORIZED", true],
    ["CONFIRMED", true],
    ["REJECTED", false],
    ["DEADLINE_EXPIRED", false],
    ["CANCELED", false],
    ["REVERSED", false],
    ["REFUNDED", true],
    ["PARTIAL_REFUNDED", true],
  ])("accepts the expected Success value for %s", (status, success) => {
    const notification = toAuthenticatedNotification({
      TerminalKey: "terminal",
      OrderId: SESSION.id,
      PaymentId: 3456789,
      Status: status,
      Amount: 1899000,
      Success: success,
    });

    expect(correlateNotification(notification, SESSION as never, "terminal")).toEqual({ kind: "correlated" });
  });

  it("claims a bounded batch atomically with a renewable 60-second lease", async () => {
    const execute = jest.fn().mockResolvedValue([{ id: "tbnotif_1", lifecycle_state: "leased" }]);
    const now = new Date("2026-09-06T12:00:00.000Z");

    const rows = await TbankNotificationModuleService.prototype.claimInbox.call(
      {}, { limit: 20, leaseToken: "lease-1", now }, { manager: { execute } } as never,
    );

    expect(rows).toEqual([{ id: "tbnotif_1", lifecycle_state: "leased" }]);
    expect(execute).toHaveBeenCalledWith(expect.stringContaining("FOR UPDATE SKIP LOCKED"), [
      now, now, now, now, now, 20, "lease-1", new Date(now.getTime() + INBOX_LEASE_MS), now, now,
    ]);
  });

  it("rejects an unbounded claim before touching storage", async () => {
    const execute = jest.fn();
    const operation = TbankNotificationModuleService.prototype.claimInbox.call(
      {}, { limit: 101, leaseToken: "worker-1", now: new Date() }, { manager: { execute } } as never,
    );

    await expect(operation).rejects.toBeInstanceOf(InboxClaimLimitError);
    expect(execute).not.toHaveBeenCalled();
  });

  it("gives concurrent workers distinct atomically claimed rows", async () => {
    const execute = jest
      .fn()
      .mockResolvedValueOnce([{ id: "tbnotif_1", lifecycle_state: "leased" }])
      .mockResolvedValueOnce([{ id: "tbnotif_2", lifecycle_state: "leased" }]);
    const now = new Date("2026-09-06T12:00:00.000Z");

    const [first, second] = await Promise.all([
      TbankNotificationModuleService.prototype.claimInbox.call(
        {}, { limit: 1, leaseToken: "worker-1", now }, { manager: { execute } } as never,
      ),
      TbankNotificationModuleService.prototype.claimInbox.call(
        {}, { limit: 1, leaseToken: "worker-2", now }, { manager: { execute } } as never,
      ),
    ]);

    expect(first.map((row) => row.id)).toEqual(["tbnotif_1"]);
    expect(second.map((row) => row.id)).toEqual(["tbnotif_2"]);
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("renews only the current lease token for another 60 seconds", async () => {
    const execute = jest.fn().mockResolvedValue([{ id: "tbnotif_1" }]);
    const now = new Date("2026-09-06T12:00:00.000Z");

    await TbankNotificationModuleService.prototype.renewInboxLease.call(
      {}, { id: "tbnotif_1", leaseToken: "lease-1", now }, { manager: { execute } } as never,
    );

    expect(execute).toHaveBeenCalledWith(expect.stringContaining("lease_token = ?"), [
      new Date(now.getTime() + INBOX_LEASE_MS), now, "tbnotif_1", "lease-1", now,
    ]);
  });

  it("makes an expired lease eligible for a later atomic claim", async () => {
    const execute = jest.fn().mockResolvedValue([{ id: "tbnotif_expired", lifecycle_state: "leased" }]);
    const now = new Date("2026-09-06T12:01:01.000Z");

    const rows = await TbankNotificationModuleService.prototype.claimInbox.call(
      {}, { limit: 1, leaseToken: "worker-2", now }, { manager: { execute } } as never,
    );

    expect(rows.map((row) => row.id)).toEqual(["tbnotif_expired"]);
    expect(execute).toHaveBeenCalledWith(expect.stringContaining("OR (lifecycle_state = 'leased'"), expect.any(Array));
    expect(execute).toHaveBeenCalledWith(expect.stringContaining("lease_expires_at <= ?"), expect.arrayContaining([now]));
  });

  it("uses the required persisted backoff schedule and exhausts after five attempts", () => {
    expect(RETRY_BACKOFF_MS).toEqual([60_000, 300_000, 1_800_000, 7_200_000, 43_200_000]);
    expect(MAX_INBOX_ATTEMPTS).toBe(5);
    const now = new Date("2026-09-06T12:00:00.000Z");

    expect(nextFailureState(1, now)).toEqual({ lifecycleState: "pending", nextAttemptAt: new Date(now.getTime() + 60_000) });
    expect(nextFailureState(5, now)).toEqual({ lifecycleState: "manual_review", nextAttemptAt: new Date(now.getTime() + 43_200_000) });
  });

  it("derives retry and exhaustion state from the persisted attempt count", async () => {
    const execute = jest.fn().mockResolvedValue([{ id: "tbnotif_1" }]);
    const now = new Date("2026-09-06T12:00:00.000Z");

    await TbankNotificationModuleService.prototype.failInbox.call(
      {}, { id: "tbnotif_1", leaseToken: "lease-1", now }, { manager: { execute } } as never,
    );

    expect(execute).toHaveBeenCalledWith(expect.stringContaining("CASE WHEN attempt_count >= 5"), expect.any(Array));
    expect(execute).toHaveBeenCalledWith(expect.stringContaining("lease_expires_at > ?"), expect.arrayContaining([now]));
  });

  it("marks only the active lease as processed", async () => {
    const execute = jest.fn().mockResolvedValue([{ id: "tbnotif_1", lifecycle_state: "processed" }]);
    const now = new Date("2026-09-06T12:00:00.000Z");

    await TbankNotificationModuleService.prototype.completeInbox.call(
      {}, { id: "tbnotif_1", leaseToken: "lease-1", now }, { manager: { execute } } as never,
    );

    expect(execute).toHaveBeenCalledWith(expect.stringContaining("lifecycle_state = 'processed'"), [
      now, now, "tbnotif_1", "lease-1", now,
    ]);
  });
});
