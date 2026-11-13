import {
  TBANK_STATUSES,
  isStatusRegression,
  isTBankStatus,
  parseNotification,
  statusRank,
  toSessionStatus,
} from "../status";


describe("toSessionStatus", () => {
  it.each([
    ["NEW", "pending_authorization"],
    ["FORM_SHOWED", "pending_authorization"],
    ["AUTHORIZING", "pending_authorization"],
    ["3DS_CHECKING", "pending_authorization"],
    ["AUTHORIZED", "pending_authorization"],
    ["CONFIRMED", "captured"],
    ["REJECTED", "error"],
    ["DEADLINE_EXPIRED", "error"],
    ["CANCELED", "canceled"],
    ["REVERSED", "canceled"],
    ["REFUNDED", "captured"],
    ["PARTIAL_REFUNDED", "captured"],
  ])("%s → %s", (status, expected) => {
    expect(toSessionStatus(status)).toBe(expected);
  });

  it("возврат не откатывает сессию из captured", () => {
    // Деньги были списаны; возврат — отдельная сущность Medusa (§8).
    expect(toSessionStatus("REFUNDED")).toBe("captured");
    expect(toSessionStatus("PARTIAL_REFUNDED")).toBe("captured");
  });

  it("неизвестный статус даёт pending", () => {
    expect(toSessionStatus("WAT")).toBe("pending");
  });
});

describe("isStatusRegression — монотонность §5.1", () => {
  /**
   * При PayType: O банк шлёт AUTHORIZED и CONFIRMED одновременно и ждёт
   * ответа 10 секунд. Порядок доставки не гарантирован — это документированное
   * поведение, а не редкая гонка.
   */
  it("CONFIRMED после AUTHORIZED — движение вперёд", () => {
    expect(isStatusRegression("AUTHORIZED", "CONFIRMED")).toBe(false);
  });

  it("AUTHORIZED после CONFIRMED — откат, игнорируется", () => {
    expect(isStatusRegression("CONFIRMED", "AUTHORIZED")).toBe(true);
  });

  it("повторный тот же статус — не движение вперёд", () => {
    for (const status of TBANK_STATUSES) {
      expect(isStatusRegression(status, status)).toBe(true);
    }
  });

  it("неуспешные терминальные исходы стоят вровень с CONFIRMED", () => {
    expect(statusRank("REJECTED")).toBe(statusRank("CONFIRMED"));
    expect(statusRank("CANCELED")).toBe(statusRank("CONFIRMED"));
    // Значит, после списания отказ уже не перезапишет состояние.
    expect(isStatusRegression("CONFIRMED", "REJECTED")).toBe(true);
  });

  it("возврат идёт после списания", () => {
    expect(isStatusRegression("CONFIRMED", "REFUNDED")).toBe(false);
    expect(isStatusRegression("REFUNDED", "CONFIRMED")).toBe(true);
  });

  it("переход в неизвестный статус считается откатом", () => {
    expect(isStatusRegression("NEW", "WAT")).toBe(true);
  });
});

describe("parseNotification", () => {
  const base = {
    TerminalKey: "1234567890",
    OrderId: "payses_01JABCDEF",
    PaymentId: 3456789,
    Status: "CONFIRMED",
    Amount: 1899000,
    Success: true,
  };

  it("разбирает корректную нотификацию", () => {
    expect(parseNotification(base)).toEqual({
      orderId: "payses_01JABCDEF",
      paymentId: "3456789",
      status: "CONFIRMED",
      amountKopecks: 1899000,
      success: true,
      errorCode: undefined,
      message: undefined,
    });
  });

  it("принимает PaymentId и числом, и строкой", () => {
    expect(parseNotification({ ...base, PaymentId: "3456789" }).paymentId).toBe(
      "3456789",
    );
  });

  it("Amount может отсутствовать — тогда 0", () => {
    const { Amount: _omitted, ...withoutAmount } = base;
    expect(parseNotification(withoutAmount).amountKopecks).toBe(0);
  });

  it("принимает Success только как обязательный boolean", () => {
    expect(parseNotification({ ...base, Success: true }).success).toBe(true);
    expect(parseNotification({ ...base, Success: false }).success).toBe(false);
  });

  it.each([undefined, "true", "false", 1, 0, null])(
    "отвергает отсутствующий или не-boolean Success: %p",
    (success) => {
      expect(() => parseNotification({ ...base, Success: success })).toThrow("Success");
    },
  );

  it("переносит диагностику отказа", () => {
    const parsed = parseNotification({
      ...base,
      Status: "REJECTED",
      Success: false,
      ErrorCode: "1051",
      Message: "Недостаточно средств",
    });
    expect(parsed.errorCode).toBe("1051");
    expect(parsed.message).toBe("Недостаточно средств");
  });

  it.each([
    ["без OrderId", { ...base, OrderId: undefined }],
    ["с пустым OrderId", { ...base, OrderId: "" }],
    ["без Status", { ...base, Status: undefined }],
    ["без PaymentId", { ...base, PaymentId: undefined }],
    ["с отрицательным Amount", { ...base, Amount: -1 }],
    ["с дробным Amount", { ...base, Amount: 10.5 }],
  ])("бросает %s", (_name, payload) => {
    expect(() => parseNotification(payload as Record<string, unknown>)).toThrow();
  });
});


describe("isTBankStatus", () => {
  it("отличает известные статусы от произвольных строк", () => {
    expect(isTBankStatus("CONFIRMED")).toBe(true);
    expect(isTBankStatus("confirmed")).toBe(false);
    expect(isTBankStatus(null)).toBe(false);
    expect(isTBankStatus(42)).toBe(false);
  });
});
