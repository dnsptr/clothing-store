/**
 * Тесты сабскрайбера на неуспешные исходы.
 *
 * Здесь проверяется наш код, а не фреймворк: штатный сабскрайбер `failed` и
 * `canceled` отбрасывает ранним `return`, поэтому всё поведение ниже
 * существует только благодаря этому обработчику.
 */

import handler from "../tbank-payment-outcome";

const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };

const SESSION = {
  id: "payses_01JABCDEF",
  data: { paymentId: "3456789" },
  currency_code: "rub",
  amount: 18990,
};

function makeContainer(action: string, overrides: Record<string, unknown> = {}) {
  const paymentService = {
    getWebhookActionAndData: jest.fn().mockResolvedValue({
      action,
      data: { session_id: SESSION.id, amount: "18990.00" },
    }),
    retrievePaymentSession: jest.fn().mockResolvedValue(SESSION),
    updatePaymentSession: jest.fn().mockResolvedValue(SESSION),
    ...overrides,
  };

  return {
    paymentService,
    container: {
      resolve: (key: string) => (key === "logger" ? logger : paymentService),
    },
  };
}

/** Аргументы обработчика целиком: спред от `as never` не типизируется. */
function makeArgs(container: unknown, provider = "tbank") {
  return {
    event: { data: { provider, payload: { data: {}, headers: {} } } },
    container,
  } as never;
}

beforeEach(() => jest.clearAllMocks());

describe("сабскрайбер неуспешных исходов", () => {
  it("переводит сессию в error при отказе банка", async () => {
    const { paymentService, container } = makeContainer("failed");

    await handler(makeArgs(container));

    expect(paymentService.updatePaymentSession).toHaveBeenCalledWith({
      id: SESSION.id,
      data: SESSION.data,
      currency_code: "rub",
      amount: 18990,
      status: "error",
    });
  });

  it("переводит сессию в canceled при отмене", async () => {
    const { paymentService, container } = makeContainer("canceled");

    await handler(makeArgs(container));

    // failed и canceled различаются намеренно: по ним потом разбирают,
    // почему заказа нет.
    expect(paymentService.updatePaymentSession).toHaveBeenCalledWith(
      expect.objectContaining({ status: "canceled" }),
    );
  });

  it.each(["authorized", "captured", "not_supported", "pending"])(
    "не трогает сессию при action=%s",
    async (action) => {
      const { paymentService, container } = makeContainer(action);

      await handler(makeArgs(container));

      // Успешные исходы ведёт штатный путь. Дублировать completeCart своими
      // руками не нужно и опасно.
      expect(paymentService.updatePaymentSession).not.toHaveBeenCalled();
    },
  );

  it("пропускает события чужих провайдеров", async () => {
    const { paymentService, container } = makeContainer("failed");

    await handler(makeArgs(container, "stripe"));

    expect(paymentService.getWebhookActionAndData).not.toHaveBeenCalled();
  });

  it("ничего не делает без session_id", async () => {
    const { paymentService, container } = makeContainer("failed", {
      getWebhookActionAndData: jest.fn().mockResolvedValue({ action: "failed" }),
    });

    await handler(makeArgs(container));

    expect(paymentService.updatePaymentSession).not.toHaveBeenCalled();
  });

  it("не падает, если сессии уже нет", async () => {
    const { container } = makeContainer("failed", {
      retrievePaymentSession: jest.fn().mockRejectedValue(new Error("not found")),
    });

    // Корзина могла истечь раньше уведомления. Факт нотификации уже в журнале,
    // ронять обработчик незачем — иначе BullMQ будет ретраить бесконечно.
    await expect(handler(makeArgs(container))).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalled();
  });
});
