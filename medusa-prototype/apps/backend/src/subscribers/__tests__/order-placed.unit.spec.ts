/**
 * Тесты подписчика на новый заказ.
 *
 * Главное здесь — независимость каналов и то, что обработчик не падает.
 * Заказ уже создан и оплачен: исключение отсюда означало бы бесконечные
 * ретраи BullMQ из-за чужого недоступного сервиса.
 */

import { Modules } from "@medusajs/framework/utils";

import handler from "../order-placed";

const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };

const ORDER = {
  id: "order_01JABCDEF",
  display_id: 1042,
  email: "buyer@example.com",
  currency_code: "rub",
  item_total: 18990,
  shipping_total: 500,
  total: 19490,
  items: [
    {
      title: "Пальто из шерсти",
      variant_title: "ONE SIZE",
      quantity: 1,
      unit_price: 15990,
      total: 15990,
    },
  ],
  shipping_address: {
    first_name: "Анна",
    last_name: "Петрова",
    phone: "+7 900 000-00-00",
    city: "Москва",
    address_1: "ул. Тверская, 1",
    postal_code: "125009",
  },
  shipping_methods: [{ name: "Курьер по Москве" }],
};

function makeContainer(orderOverrides: Record<string, unknown> = {}) {
  const orderService = {
    retrieveOrder: jest.fn().mockResolvedValue(ORDER),
    ...orderOverrides,
  };
  const notificationService = {
    createNotifications: jest.fn().mockResolvedValue({}),
  };

  return {
    orderService,
    notificationService,
    container: {
      resolve: (key: string) => {
        if (key === "logger") return logger;
        if (key === Modules.ORDER) return orderService;
        return notificationService;
      },
    },
  };
}

/** Аргументы обработчика целиком: спред от `as never` не типизируется. */
function makeArgs(container: unknown, id: string = ORDER.id) {
  return { event: { data: { id } }, container } as never;
}

/**
 * Событие без идентификатора заказа — отдельной функцией, а не `makeArgs(c, undefined)`:
 * явный `undefined` подставил бы значение по умолчанию, и тест молча проверял бы
 * обычный случай вместо пустого события.
 */
function makeArgsWithoutOrderId(container: unknown) {
  return { event: { data: {} }, container } as never;
}

type SentNotification = {
  to?: string;
  channel?: string;
  template?: string;
  resource_id?: string;
  resource_type?: string;
  idempotency_key?: string;
  content?: { subject?: string; text?: string; html?: string };
};

/** Уведомление, отправленное в указанный канал. */
function notificationFor(
  createNotifications: jest.Mock,
  channel: string,
): SentNotification | undefined {
  return createNotifications.mock.calls
    .map((call) => call[0] as SentNotification)
    .find((notification) => notification.channel === channel);
}

const ENV = { ...process.env };

beforeEach(() => {
  jest.clearAllMocks();
  process.env = { ...ENV, TELEGRAM_CHAT_ID: "-1001234567890" };
});

afterAll(() => {
  process.env = ENV;
});

describe("подписчик на новый заказ", () => {
  it("читает заказ с суммами", async () => {
    const { orderService, container } = makeContainer();

    await handler(makeArgs(container));

    const [, config] = orderService.retrieveOrder.mock.calls[0];
    // Без полей сумм в `select` модуль заказов не считает тоталы вообще, и в
    // письме покупателю на месте итога стоял бы прочерк.
    expect(config.select).toEqual(expect.arrayContaining(["total", "item_total", "shipping_total"]));
    expect(config.relations).toEqual(
      expect.arrayContaining(["items", "shipping_address", "shipping_methods"]),
    );
  });

  it("шлёт сообщение сотрудникам и письмо покупателю", async () => {
    const { notificationService, container } = makeContainer();

    await handler(makeArgs(container));

    expect(notificationService.createNotifications).toHaveBeenCalledTimes(2);

    const staff = notificationFor(notificationService.createNotifications, "telegram");
    expect(staff).toMatchObject({
      to: "-1001234567890",
      template: "order-placed",
      resource_id: ORDER.id,
      resource_type: "order",
      idempotency_key: `order-placed:${ORDER.id}:telegram`,
    });

    const customer = notificationFor(notificationService.createNotifications, "email");
    expect(customer).toMatchObject({
      to: "buyer@example.com",
      template: "order-placed",
      resource_id: ORDER.id,
      resource_type: "order",
      idempotency_key: `order-placed:${ORDER.id}:email`,
    });
  });

  it("кладёт в письмо и текст, и HTML", async () => {
    const { notificationService, container } = makeContainer();

    await handler(makeArgs(container));

    const customer = notificationFor(notificationService.createNotifications, "email");

    expect(customer?.content?.subject).toContain("№1042");
    expect(customer?.content?.text).toContain("Здравствуйте, Анна!");
    expect(customer?.content?.text).toContain("Итого: 19 490 ₽");
    expect(customer?.content?.html).toContain("<table");
  });

  it("пишет покупателю даже без чата сотрудников", async () => {
    // Канал `email` обслуживает `notification-local`, когда почта не настроена:
    // цепочка «заказ → письмо» должна работать и в разработке, и в CI.
    delete process.env.TELEGRAM_CHAT_ID;
    const { notificationService, container } = makeContainer();

    await handler(makeArgs(container));

    expect(notificationService.createNotifications).toHaveBeenCalledTimes(1);
    expect(notificationFor(notificationService.createNotifications, "email")).toBeDefined();
  });

  it("отправляет письмо, даже если Telegram упал", async () => {
    const { notificationService, container } = makeContainer();
    notificationService.createNotifications
      .mockRejectedValueOnce(new Error("chat not found"))
      .mockResolvedValue({});

    await expect(handler(makeArgs(container))).resolves.toBeUndefined();

    expect(notificationFor(notificationService.createNotifications, "email")).toBeDefined();
    expect(logger.error).toHaveBeenCalled();
  });

  it("не роняет обработчик, если письмо не ушло", async () => {
    const { notificationService, container } = makeContainer();
    notificationService.createNotifications
      .mockResolvedValueOnce({})
      .mockRejectedValue(new Error("SMTP timeout"));

    await expect(handler(makeArgs(container))).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalled();
  });

  it("без почты в заказе письмо не шлёт, но сотрудников оповещает", async () => {
    const { notificationService, container } = makeContainer({
      retrieveOrder: jest.fn().mockResolvedValue({ ...ORDER, email: "  " }),
    });

    await handler(makeArgs(container));

    expect(notificationFor(notificationService.createNotifications, "telegram")).toBeDefined();
    expect(notificationFor(notificationService.createNotifications, "email")).toBeUndefined();
    expect(logger.warn).toHaveBeenCalled();
  });

  it("не отправляет ничего, если заказ не прочитан", async () => {
    const { notificationService, container } = makeContainer({
      retrieveOrder: jest.fn().mockRejectedValue(new Error("not found")),
    });

    await expect(handler(makeArgs(container))).resolves.toBeUndefined();

    expect(notificationService.createNotifications).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalled();
  });

  it("игнорирует событие без идентификатора заказа", async () => {
    const { orderService, notificationService, container } = makeContainer();

    await handler(makeArgsWithoutOrderId(container));

    expect(orderService.retrieveOrder).not.toHaveBeenCalled();
    expect(notificationService.createNotifications).not.toHaveBeenCalled();
  });
});
