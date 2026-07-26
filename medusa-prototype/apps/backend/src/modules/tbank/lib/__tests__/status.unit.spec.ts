import {
  TBANK_STATUSES,
  isStatusRegression,
  isTBankStatus,
  parseNotification,
  statusRank,
  toSessionStatus,
  toWebhookAction,
  toWebhookActionAndData,
} from "../status";

describe("toWebhookAction — таблица §4.3", () => {
  // Таблица продублирована здесь литералами намеренно. Если импортировать её
  // из модуля, тест проверял бы сам себя: любая правка отображения поехала бы
  // вместе с ожиданиями и осталась незамеченной.
  it.each([
    ["NEW", "not_supported"],
    ["FORM_SHOWED", "not_supported"],
    ["AUTHORIZING", "not_supported"],
    ["3DS_CHECKING", "not_supported"],
    ["AUTHORIZED", "authorized"],
    ["CONFIRMED", "captured"],
    ["REJECTED", "failed"],
    ["DEADLINE_EXPIRED", "failed"],
    ["CANCELED", "canceled"],
    ["REVERSED", "canceled"],
    ["REFUNDED", "not_supported"],
    ["PARTIAL_REFUNDED", "not_supported"],
  ])("%s → %s", (status, expected) => {
    expect(toWebhookAction(status)).toBe(expected);
  });

  /**
   * Главный тест файла. `processPaymentWorkflow` не проверяет action в
   * последней ветке `when`: любой дошедший до воркфлоу action при связанной
   * корзине и отсутствующем заказе завершает корзину. `pending` до воркфлоу
   * доходит, `not_supported` — нет.
   *
   * Регрессия здесь проявится не как упавший тест где-то ещё, а как заказ,
   * созданный в момент, когда покупатель только открыл платёжную форму.
   */
  it("нетерминальные статусы никогда не дают pending", () => {
    for (const status of ["NEW", "FORM_SHOWED", "AUTHORIZING", "3DS_CHECKING"]) {
      expect(toWebhookAction(status)).toBe("not_supported");
      expect(toWebhookAction(status)).not.toBe("pending");
    }
  });

  it("ни один статус не отображается в pending", () => {
    for (const status of TBANK_STATUSES) {
      expect(toWebhookAction(status)).not.toBe("pending");
    }
  });

  it("неизвестный статус деградирует в not_supported, а не в успех", () => {
    for (const unknown of ["", "SOMETHING_NEW", "authorized", "confirmed"]) {
      expect(toWebhookAction(unknown)).toBe("not_supported");
    }
  });

  it("таблица покрывает все объявленные статусы", () => {
    for (const status of TBANK_STATUSES) {
      expect(toWebhookAction(status)).toBeDefined();
    }
  });
});

describe("toSessionStatus", () => {
  it.each([
    ["NEW", "pending_authorization"],
    ["FORM_SHOWED", "pending_authorization"],
    ["AUTHORIZING", "pending_authorization"],
    ["3DS_CHECKING", "pending_authorization"],
    ["AUTHORIZED", "authorized"],
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

  it("Success !== true даёт success: false", () => {
    expect(parseNotification({ ...base, Success: false }).success).toBe(false);
    expect(parseNotification({ ...base, Success: "true" }).success).toBe(false);
  });

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

describe("toWebhookActionAndData — §4.5", () => {
  it("конвертирует копейки в рубли, а не отдаёт их как есть", () => {
    const result = toWebhookActionAndData({
      orderId: "payses_01JABCDEF",
      paymentId: "3456789",
      status: "CONFIRMED",
      amountKopecks: 1899000,
      success: true,
    });

    expect(result.action).toBe("captured");
    expect(result.data.session_id).toBe("payses_01JABCDEF");
    // 1 899 000 копеек = 18 990 рублей. Значение уходит в
    // capturePaymentWorkflow как сумма списания: ошибка масштаба здесь — это
    // списание в сто раз больше или меньше.
    expect(result.data.amount).toBe("18990.00");
  });

  it("копейки не теряются", () => {
    const result = toWebhookActionAndData({
      orderId: "payses_x",
      paymentId: "1",
      status: "CONFIRMED",
      amountKopecks: 1899099,
      success: true,
    });
    expect(result.data.amount).toBe("18990.99");
  });

  it("session_id — это OrderId, а не PaymentId", () => {
    // §5.3: в OrderId кладётся id платёжной сессии Medusa. Перепутать их
    // означает искать сессию по идентификатору банка и не находить.
    const result = toWebhookActionAndData({
      orderId: "payses_correct",
      paymentId: "999",
      status: "AUTHORIZED",
      amountKopecks: 100,
      success: true,
    });
    expect(result.data.session_id).toBe("payses_correct");
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
