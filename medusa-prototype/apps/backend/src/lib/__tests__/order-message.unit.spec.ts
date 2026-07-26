import {
  buildNewOrderMessage,
  formatAddress,
  formatAmount,
  orderNumber,
  type OrderForMessage,
} from "../order-message";

const ORDER: OrderForMessage = {
  id: "order_01JABCDEF",
  display_id: 1042,
  email: "buyer@example.com",
  currency_code: "rub",
  total: 18990,
  items: [
    { title: "Пальто из шерсти", variant_title: "ONE SIZE", quantity: 1, unit_price: 15990 },
    { title: "Шарф кашемировый", variant_title: "ONE SIZE", quantity: 1, unit_price: 3000 },
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

describe("formatAmount", () => {
  it("форматирует рубли по-русски", () => {
    expect(formatAmount(18990, "rub")).toBe("18 990 ₽");
  });

  it("показывает копейки двумя знаками, как положено деньгам", () => {
    expect(formatAmount(18990.5, "rub")).toBe("18 990,50 ₽");
    expect(formatAmount(18990.99, "rub")).toBe("18 990,99 ₽");
  });

  it("не дописывает копейки к целой сумме", () => {
    expect(formatAmount(18990, "rub")).toBe("18 990 ₽");
  });

  it("разделитель разрядов — обычный пробел, а не неразрывный", () => {
    // Иначе вывод зависит от версии ICU в конкретной сборке Node, и одно и то
    // же сообщение выглядит по-разному в логах, тестах и Telegram.
    expect(formatAmount(1899000, "rub")).toBe("1 899 000 ₽");
    expect(formatAmount(1899000, "rub")).not.toMatch(/[  ]/);
  });

  it("принимает строку — Medusa отдаёт суммы и так", () => {
    expect(formatAmount("15990", "rub")).toBe("15 990 ₽");
  });

  it("понимает BigNumber, которым Medusa отдаёт тоталы заказа", () => {
    // В DTO заказа суммы приходят объектами: у них есть valueOf(), но typeof —
    // object. Без этого любая сумма из retrieveOrder стала бы прочерком.
    const bigNumber = { numeric: 19490, valueOf: () => 19490 };
    expect(formatAmount(bigNumber, "rub")).toBe("19 490 ₽");
  });

  it("понимает сырое представление суммы", () => {
    expect(formatAmount({ value: "19490.50", precision: 20 } as never, "rub")).toBe(
      "19 490,50 ₽",
    );
  });

  it("объект без числа внутри — прочерк, а не ноль", () => {
    expect(formatAmount({} as never, "rub")).toBe("—");
  });

  it.each([null, undefined, "", "не число", NaN])(
    "отсутствующая сумма (%s) даёт прочерк, а не ноль",
    (value) => {
      // Ноль — это утверждение о деньгах: в уведомлении о заказе он означал бы
      // бесплатный заказ. Отсутствие суммы должно выглядеть как отсутствие.
      expect(formatAmount(value as never, "rub")).toBe("—");
      expect(formatAmount(value as never, "rub")).not.toContain("0");
    },
  );

  it("незнакомую валюту показывает кодом", () => {
    expect(formatAmount(100, "usd")).toBe("100 USD");
  });
});

describe("orderNumber", () => {
  it("предпочитает display_id", () => {
    expect(orderNumber(ORDER)).toBe("№1042");
  });

  it("падает обратно на внутренний id", () => {
    expect(orderNumber({ ...ORDER, display_id: null })).toBe("order_01JABCDEF");
  });
});

describe("formatAddress", () => {
  it("собирает адрес от индекса до квартиры", () => {
    // Квартиру витрина спрашивает отдельным полем: без неё курьеру некуда ехать.
    expect(formatAddress({ ...ORDER.shipping_address, address_2: "кв. 5" })).toBe(
      "125009, Москва, ул. Тверская, 1, кв. 5",
    );
  });

  it("пропускает незаполненное, не оставляя запятых подряд", () => {
    expect(formatAddress({ city: "Москва", address_1: "", postal_code: "  " })).toBe("Москва");
  });

  it.each([null, undefined, {}])("без адреса (%s) говорит об этом словами", (address) => {
    expect(formatAddress(address as never)).toBe("адрес не указан");
  });
});

describe("buildNewOrderMessage", () => {
  it("собирает читаемое сообщение", () => {
    const message = buildNewOrderMessage(ORDER);

    expect(message).toContain("Новый заказ №1042");
    expect(message).toContain("Анна Петрова");
    expect(message).toContain("+7 900 000-00-00");
    expect(message).toContain("Курьер по Москве — 125009, Москва, ул. Тверская, 1");
    expect(message).toContain("Пальто из шерсти, ONE SIZE × 1 — 15 990 ₽");
    expect(message).toContain("Итого: 18 990 ₽");
  });

  it("не оставляет разметки — имена покупателей не надо экранировать", () => {
    const message = buildNewOrderMessage({
      ...ORDER,
      shipping_address: { ...ORDER.shipping_address, last_name: "Петрова_Иванова" },
    });
    // Символ подчёркивания в Markdown Telegram открыл бы курсив и сломал
    // отправку. Поэтому сообщение — простой текст.
    expect(message).toContain("Петрова_Иванова");
    expect(message).not.toMatch(/[*_`]\w+[*_`]/);
  });

  it("показывает отсутствие адреса словами, а не пустыми запятыми", () => {
    const message = buildNewOrderMessage({
      ...ORDER,
      shipping_address: { first_name: "Анна", phone: "+7 900 000-00-00" },
    });

    expect(message).toContain("адрес не указан");
    expect(message).not.toContain(", ,");
  });

  it("собирает частичный адрес без лишней пунктуации", () => {
    const message = buildNewOrderMessage({
      ...ORDER,
      shipping_address: { ...ORDER.shipping_address, postal_code: "", address_1: "" },
    });

    expect(message).toContain("Курьер по Москве — Москва");
  });

  it("не скрывает заказ без позиций", () => {
    const message = buildNewOrderMessage({ ...ORDER, items: [] });
    // Такого быть не должно, но если случилось — менеджер обязан это увидеть,
    // а не получить сообщение с пустым разделом.
    expect(message).toContain("позиции не переданы");
  });

  it("переживает отсутствие контактов", () => {
    const message = buildNewOrderMessage({ id: "order_x" });

    expect(message).toContain("order_x");
    expect(message).toContain("Телефон: —");
    expect(message).toContain("Почта: —");
    expect(message).toContain("Итого: —");
  });

  it("подставляет заглушку вместо пустого названия позиции", () => {
    const message = buildNewOrderMessage({
      ...ORDER,
      items: [{ title: "", quantity: 2, unit_price: 100 }],
    });
    expect(message).toContain("без названия × 2");
  });
});
