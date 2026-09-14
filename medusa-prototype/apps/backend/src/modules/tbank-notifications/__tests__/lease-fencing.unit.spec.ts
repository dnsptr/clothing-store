import TbankNotificationModuleService from "../service";

describe("T-Bank notification lease fencing", () => {
  it("persists conflict audit and quarantine through one fenced statement", async () => {
    const execute = jest.fn().mockResolvedValue([{ canonical_notification_id: "tbnotif_conflict" }]);
    const now = new Date("2026-09-12T00:00:00.000Z");

    const operation = Reflect.get(TbankNotificationModuleService.prototype, "quarantineConflict");
    if (typeof operation !== "function") throw new TypeError("quarantineConflict is unavailable");
    const rows = await Reflect.apply(operation, {}, [
      { id: "tbnotif_conflict", leaseToken: "current-lease", reason: "Correlation mismatch: amount", now },
      { manager: { execute } },
    ]);

    expect(rows).toHaveLength(1);
    expect(execute).toHaveBeenCalledTimes(1);
    const [sql, parameters] = execute.mock.calls[0];
    expect(sql).toContain("WITH quarantined AS");
    expect(sql).toContain("INSERT INTO tbank_notification_conflict");
    expect(sql).toContain("conflict_kind");
    expect(sql).toContain("correlation_mismatch");
    expect(sql).toContain("lifecycle_state = 'leased'");
    expect(sql).toContain("lease_token = ?");
    expect(sql).toContain("lease_expires_at > ?");
    expect(parameters).toEqual(expect.arrayContaining([
      "tbnotif_conflict",
      "current-lease",
      "Correlation mismatch: amount",
      now,
    ]));
  });

  it("persists retry transition and operator audit in one statement", async () => {
    const execute = jest.fn().mockResolvedValue([{ id: "tbnotif_audit", lifecycle_state: "pending" }]);
    const now = new Date("2026-09-12T00:00:00.000Z");

    await Reflect.apply(TbankNotificationModuleService.prototype.retryManualReview, {}, [
      { id: "tbnotif_audit", operatorId: "user_admin", reason: "Storage recovered", now },
      { manager: { execute } },
    ]);

    expect(execute).toHaveBeenCalledTimes(1);
    const [sql, parameters] = execute.mock.calls[0];
    expect(sql).toContain("WITH updated AS");
    expect(sql).toContain("operator_retry");
    expect(parameters).toEqual(expect.arrayContaining([
      expect.stringContaining("user_admin"),
      expect.stringContaining("Storage recovered"),
    ]));
  });

  it("returns expired exhausted rows from an atomic manual-review transition", async () => {
    const execute = jest.fn().mockResolvedValue([
      { id: "tbnotif_exhausted", lifecycle_state: "manual_review", attempt_count: 5 },
    ]);
    const now = new Date("2026-09-12T00:00:00.000Z");

    const operation = Reflect.get(TbankNotificationModuleService.prototype, "quarantineExpiredExhausted");
    if (typeof operation !== "function") throw new TypeError("quarantineExpiredExhausted is unavailable");
    const rows = await Reflect.apply(
      operation,
      {},
      [{ now }, { manager: { execute } }],
    );

    expect(rows).toHaveLength(1);
    const [sql, parameters] = execute.mock.calls[0];
    expect(sql).toContain("UPDATE tbank_notification");
    expect(sql).toContain("FOR UPDATE SKIP LOCKED");
    expect(sql).toContain("LIMIT 100");
    expect(sql).toContain("RETURNING inbox.*");
    expect(sql).toContain("lease_expires_at <= ?");
    expect(parameters).toEqual(expect.arrayContaining([now]));
  });
});
