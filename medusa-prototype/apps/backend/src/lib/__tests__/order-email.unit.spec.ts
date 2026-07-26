import {
  buildOrderEmail,
  buildOrderEmailHtml,
  buildOrderEmailSubject,
  buildOrderEmailText,
  escapeHtml,
  extractEmailAddress,
  type OrderForEmail,
} from "../order-email";

const ORDER: OrderForEmail = {
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
    {
      title: "Шарф кашемировый",
      variant_title: "ONE SIZE",
      quantity: 2,
      unit_price: 1500,
      total: 3000,
    },
  ],
  shipping_address: {
    first_name: "Анна",
    last_name: "Петрова",
    phone: "+7 900 000-00-00",
    city: "Москва",
    address_1: "ул. Тверская, 1",
    address_2: "кв. 5",
    postal_code: "125009",
  },
  shipping_methods: [{ name: "Курьер по Москве" }],
};

const SHOP = { email: "shop@example.ru", url: "https://www.mariomikke.shop" };

describe("extractEmailAddress", () => {
  it("достаёт адрес из «Имя <адрес>»", () => {
    // SMTP_FROM почти всегда задают с отображаемым именем, а в подписи нужен
    // только адрес.
    expect(extractEmailAddress("Mario Mikke <shop@example.ru>")).toBe("shop@example.ru");
  });

  it("принимает голый адрес", () => {
    expect(extractEmailAddress("  shop@example.ru ")).toBe("shop@example.ru");
  });

  it.each([undefined, null, "", "   ", "Mario Mikke"])(
    "без адреса (%s) возвращает undefined",
    (value) => {
      expect(extractEmailAddress(value as never)).toBeUndefined();
    },
  );
});

describe("buildOrderEmailSubject", () => {
  it("называет магазин и номер заказа", () => {
    // По теме письмо ищут в почте через полгода — номер заказа обязателен.
    expect(buildOrderEmailSubject(ORDER)).toBe("Mario Mikke: заказ №1042 принят");
  });

  it("падает обратно на внутренний id", () => {
    expect(buildOrderEmailSubject({ ...ORDER, display_id: null })).toContain("order_01JABCDEF");
  });
});

describe("buildOrderEmailText", () => {
  it("здоровается по имени и подтверждает заказ", () => {
    const text = buildOrderEmailText(ORDER, SHOP);

    expect(text).toContain("Здравствуйте, Анна!");
    expect(text).toContain("Мы получили ваш заказ №1042");
  });

  it("перечисляет позиции с размером, количеством и ценой", () => {
    const text = buildOrderEmailText(ORDER, SHOP);

    expect(text).toContain("Пальто из шерсти, ONE SIZE — 1 × 15 990 ₽ = 15 990 ₽");
    expect(text).toContain("Шарф кашемировый, ONE SIZE — 2 × 1 500 ₽ = 3 000 ₽");
  });

  it("показывает товары, доставку и итог", () => {
    const text = buildOrderEmailText(ORDER, SHOP);

    expect(text).toContain("Товары: 18 990 ₽");
    expect(text).toContain("Доставка: 500 ₽");
    expect(text).toContain("Итого: 19 490 ₽");
  });

  it("показывает копейки двумя знаками", () => {
    const text = buildOrderEmailText({ ...ORDER, total: 19490.5, shipping_total: 500.99 }, SHOP);

    expect(text).toContain("Итого: 19 490,50 ₽");
    expect(text).toContain("Доставка: 500,99 ₽");
  });

  it("берёт сумму товаров из subtotal, если item_total нет", () => {
    const text = buildOrderEmailText({ ...ORDER, item_total: undefined, subtotal: 18990 }, SHOP);
    expect(text).toContain("Товары: 18 990 ₽");
  });

  it("не считает сумму позиции сам, если её не передали", () => {
    // Перемножать цену на количество нельзя: скидки и налог в эту арифметику
    // не входят, и покупатель увидел бы сумму, которой нет ни в одном документе.
    const text = buildOrderEmailText(
      { ...ORDER, items: [{ title: "Шарф", quantity: 3, unit_price: 1000 }] },
      SHOP,
    );
    const line = text.split("\n").find((candidate) => candidate.includes("Шарф"));

    expect(line?.trim()).toBe("Шарф — 3 × 1 000 ₽");
  });

  it("везёт курьера по полному адресу, включая квартиру", () => {
    const text = buildOrderEmailText(ORDER, SHOP);

    expect(text).toContain("Курьер по Москве");
    expect(text).toContain("125009, Москва, ул. Тверская, 1, кв. 5");
    expect(text).toContain("Получатель: Анна Петрова, +7 900 000-00-00");
  });

  it("объясняет, что будет дальше, и зовёт ответить письмом", () => {
    const text = buildOrderEmailText(ORDER, SHOP);

    expect(text).toContain("Что дальше:");
    expect(text).toContain("передадим его в доставку");
    expect(text).toContain("ответьте на это письмо");
  });

  it("подписывается магазином и его контактами", () => {
    const text = buildOrderEmailText(ORDER, SHOP);

    expect(text).toContain("Mario Mikke");
    expect(text).toContain("shop@example.ru");
    expect(text).toContain("https://www.mariomikke.shop");
  });

  it("без контактов в окружении не пишет пустых строк", () => {
    const text = buildOrderEmailText(ORDER);

    // Выдуманный ящик хуже отсутствующего: покупатель напишет в никуда.
    expect(text).not.toContain("undefined");
    expect(text.trimEnd().endsWith("Mario Mikke")).toBe(true);
  });

  it("показывает отсутствие адреса словами, а не пустыми запятыми", () => {
    const text = buildOrderEmailText({ ...ORDER, shipping_address: null }, SHOP);

    expect(text).toContain("адрес не указан");
    expect(text).not.toContain(", ,");
    // Без имени в адресе здороваться по имени не с кем.
    expect(text).toContain("Здравствуйте!");
    expect(text).not.toContain("Получатель:");
  });

  it("не скрывает заказ без позиций", () => {
    const text = buildOrderEmailText({ ...ORDER, items: [] }, SHOP);
    expect(text).toContain("позиции не переданы");
  });

  it("переживает заказ без сумм", () => {
    const text = buildOrderEmailText({ id: "order_x" }, SHOP);

    // Ноль означал бы бесплатный заказ, поэтому отсутствие суммы — прочерк.
    expect(text).toContain("Итого: —");
    expect(text).toContain("Товары: —");
    expect(text).not.toContain("0 ₽");
  });
});

describe("escapeHtml", () => {
  it("экранирует всё, чем можно сломать разметку", () => {
    expect(escapeHtml('<b>"Пальто" & \'шарф\'</b>')).toBe(
      "&lt;b&gt;&quot;Пальто&quot; &amp; &#39;шарф&#39;&lt;/b&gt;",
    );
  });
});

describe("buildOrderEmailHtml", () => {
  it("собирает таблицу заказа", () => {
    const html = buildOrderEmailHtml(ORDER, SHOP);

    expect(html).toContain("<table");
    expect(html).toContain("Пальто из шерсти, ONE SIZE");
    expect(html).toContain("2 × 1 500 ₽");
    expect(html).toContain("<strong>Итого</strong>");
    expect(html).toContain("<strong>19 490 ₽</strong>");
  });

  it("экранирует данные покупателя", () => {
    const html = buildOrderEmailHtml(
      {
        ...ORDER,
        items: [{ title: "<script>alert(1)</script>", quantity: 1, unit_price: 100, total: 100 }],
        shipping_address: { ...ORDER.shipping_address, last_name: 'Петрова"' },
      },
      SHOP,
    );

    // Название товара и адрес вводит покупатель: без экранирования письмо
    // превращается в площадку для чужого HTML.
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("Петрова&quot;");
  });

  it("обходится инлайновыми стилями", () => {
    const html = buildOrderEmailHtml(ORDER, SHOP);

    // Почтовые клиенты вырезают <style>, поэтому оформление живёт в атрибутах.
    expect(html).not.toContain("<style");
    expect(html).toContain("style=");
  });

  it("не скрывает заказ без позиций", () => {
    const html = buildOrderEmailHtml({ ...ORDER, items: [] }, SHOP);
    expect(html).toContain("позиции не переданы");
  });
});

describe("buildOrderEmail", () => {
  it("собирает тему, текст и HTML из одного заказа", () => {
    const email = buildOrderEmail(ORDER, SHOP);

    expect(email.subject).toBe(buildOrderEmailSubject(ORDER, SHOP));
    expect(email.text).toBe(buildOrderEmailText(ORDER, SHOP));
    expect(email.html).toBe(buildOrderEmailHtml(ORDER, SHOP));
    // Текстовая часть отправляется всегда: без неё письмо чаще уходит в спам.
    expect(email.text.length).toBeGreaterThan(0);
  });
});
