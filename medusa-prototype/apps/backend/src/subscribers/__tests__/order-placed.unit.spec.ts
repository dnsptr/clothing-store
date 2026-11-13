/**
 * Paid-order notifications keep channels independent, preserve idempotency
 * keys and propagate failures so the event bus can retry undelivered messages.
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
  delete process.env.ORDER_NOTIFICATION_EMAIL;
});

afterAll(() => {
  process.env = ENV;
});

describe("подписчик на новый заказ", () => {

  it("передаёт сотрудникам выбранный магазин и отправляет письмо покупателю самовывоза", async () => {
    const pickup = {
      ...ORDER,
      shipping_total: 0,
      total: ORDER.item_total,
      shipping_methods: [{ name: "Самовывоз из магазина (Москва, бесплатно)" }],
      shipping_address: {
        ...ORDER.shipping_address,
        postal_code: "",
        address_1: "ТЦ «Небо», г. Москва, ул. Авиаторов, д. 3А",
      },
    };
    const { notificationService, container } = makeContainer({
      retrieveOrder: jest.fn().mockResolvedValue(pickup),
    });

    await handler(makeArgs(container));

    expect(notificationService.createNotifications).toHaveBeenCalledTimes(2);
    const staff = notificationFor(notificationService.createNotifications, "telegram");
    expect(staff?.to).toBe("-1001234567890");
    expect(staff?.content?.text).toContain("ТЦ «Небо», г. Москва, ул. Авиаторов, д. 3А");
    expect(staff?.content?.text).toContain("Телефон: +7 900 000-00-00");

    const customer = notificationFor(notificationService.createNotifications, "email");
    expect(customer?.to).toBe(pickup.email);
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

    await expect(handler(makeArgs(container))).rejects.toThrow("chat not found");

    expect(notificationFor(notificationService.createNotifications, "email")).toBeDefined();
    expect(logger.error).toHaveBeenCalled();
  });

  it("propagates email failure for event-bus retry", async () => {
    const { notificationService, container } = makeContainer();
    notificationService.createNotifications
      .mockResolvedValueOnce({})
      .mockRejectedValue(new Error("SMTP timeout"));

    await expect(handler(makeArgs(container))).rejects.toThrow("SMTP timeout");
    expect(logger.error).toHaveBeenCalled();
  });

  it("notifies staff by email when the customer has no email and Telegram is disabled", async () => {
    delete process.env.TELEGRAM_CHAT_ID;
    process.env.ORDER_NOTIFICATION_EMAIL = "staff@example.com";
    const { notificationService, container } = makeContainer({
      retrieveOrder: jest.fn().mockResolvedValue({ ...ORDER, email: "" }),
    });

    await handler(makeArgs(container));

    expect(notificationService.createNotifications).toHaveBeenCalledTimes(1);
    expect(notificationFor(notificationService.createNotifications, "email")?.to).toBe("staff@example.com");
  });

  it("still notifies the buyer and requests retry when staff email delivery fails", async () => {
    delete process.env.TELEGRAM_CHAT_ID;
    process.env.ORDER_NOTIFICATION_EMAIL = "staff@example.com";
    const { notificationService, container } = makeContainer();
    notificationService.createNotifications.mockImplementation(async notification => {
      if (notification.to === process.env.ORDER_NOTIFICATION_EMAIL) {
        throw new Error("staff mailbox unavailable");
      }
      return {};
    });

    await expect(handler(makeArgs(container))).rejects.toThrow("staff mailbox unavailable");

    const attempted = notificationService.createNotifications.mock.calls.map(([notification]) => notification);
    expect(attempted.some(notification => notification.to === ORDER.email)).toBe(true);
    expect(new Set(attempted.map(notification => notification.idempotency_key)).size).toBe(2);
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

    await expect(handler(makeArgs(container))).rejects.toThrow("not found");

    expect(notificationService.createNotifications).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalled();
  });

  it("reuses the same channel idempotency keys on redelivery after an email failure", async () => {
    const { notificationService, container } = makeContainer();
    notificationService.createNotifications
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error("SMTP timeout"))
      .mockResolvedValue({});
    await expect(handler(makeArgs(container))).rejects.toThrow("SMTP timeout");
    await handler(makeArgs(container));
    const keys = notificationService.createNotifications.mock.calls.map(([notification]) => notification.idempotency_key);
    expect(keys).toEqual([
      `order-placed:${ORDER.id}:telegram`, `order-placed:${ORDER.id}:email`,
      `order-placed:${ORDER.id}:telegram`, `order-placed:${ORDER.id}:email`,
    ]);
  });

  it("does not lose a staff failure when the order has no email", async () => {
    const { notificationService, container } = makeContainer({
      retrieveOrder: jest.fn().mockResolvedValue({ ...ORDER, email: "" }),
    });
    notificationService.createNotifications.mockRejectedValue(new Error("chat not found"));
    await expect(handler(makeArgs(container))).rejects.toThrow("chat not found");
  });

  it("игнорирует событие без идентификатора заказа", async () => {
    const { orderService, notificationService, container } = makeContainer();

    await handler(makeArgsWithoutOrderId(container));

    expect(orderService.retrieveOrder).not.toHaveBeenCalled();
    expect(notificationService.createNotifications).not.toHaveBeenCalled();
  });
});
