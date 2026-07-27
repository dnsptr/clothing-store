/**
 * Письмо покупателю о принятом заказе.
 *
 * Отдельная чистая функция по той же причине, что и текст для менеджеров
 * (`order-message.ts`): почтовый провайдер сменится — Unisender, Яндекс, свой
 * relay, — а требования к содержанию письма останутся. Здесь их и тестируем,
 * без SMTP и без контейнера.
 *
 * Читает это письмо покупатель, а не сотрудник. Ему нужно убедиться, что заказ
 * принят именно тот: номер, что купил, за сколько, куда везём, что будет
 * дальше и куда писать, если что-то не так. Внутренних сведений (id заказа в
 * базе, статусы, суммы налогов) здесь нет.
 *
 * Шаблонизатора нет намеренно. Одно письмо не оправдывает ни react-email, ни
 * handlebars: зависимость пришлось бы поддерживать, а собрать текст и таблицу
 * строками — тридцать строк кода, которые целиком видны в тесте.
 */

import {
  customerName,
  formatAddress,
  formatAmount,
  orderNumber,
  type MoneyValue,
  type OrderForMessage,
} from "./order-message";

/** Позиция заказа в письме: к полям для менеджера добавлена сумма строки. */
export type OrderEmailItem = {
  title?: string | null;
  variant_title?: string | null;
  quantity?: number | null;
  unit_price?: MoneyValue;
  /** Сумма позиции с учётом скидок и налога — её считает Medusa, не мы. */
  total?: MoneyValue;
};

/** Минимум полей заказа, от которого зависит письмо. */
export interface OrderForEmail extends Omit<OrderForMessage, "items"> {
  items?: OrderEmailItem[] | null;
  /** Сумма товаров без доставки. */
  item_total?: MoneyValue;
  subtotal?: MoneyValue;
  shipping_total?: MoneyValue;
}

/**
 * Контакты магазина в подписи.
 *
 * Приходят снаружи, а не зашиты в код: адрес отправителя и адрес витрины
 * задаются переменными окружения и на разных стендах разные. Пустые значения
 * просто не попадают в письмо — выдумывать почтовый ящик, которого нет, хуже,
 * чем обойтись без него: покупатель напишет в пустоту.
 */
export type ShopContacts = {
  name?: string | null;
  email?: string | null;
  url?: string | null;
};

const DEFAULT_SHOP_NAME = "Mario Mikke";

const WHAT_NEXT =
  "Мы соберём заказ и передадим его в доставку. " +
  "Когда заказ будет отправлен, мы напишем ещё раз.";

const CONTACT_INVITE =
  "Если нужно что-то уточнить или изменить в заказе, ответьте на это письмо — мы на связи.";

/**
 * Адрес из значения вида `Mario Mikke <shop@example.ru>`.
 *
 * SMTP_FROM почти всегда задают с отображаемым именем, а в подписи письма
 * покупателю нужен только адрес: «напишите нам на Mario Mikke <shop@…>» —
 * не адрес, а мусор.
 */
export function extractEmailAddress(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;

  const angled = trimmed.match(/<([^<>]+)>/);
  const address = (angled ? angled[1] : trimmed).trim();
  return address.includes("@") ? address : undefined;
}

function shopName(shop: ShopContacts): string {
  return shop.name?.trim() || DEFAULT_SHOP_NAME;
}

/** Тема письма: магазин и номер заказа — по ним письмо ищут в почте. */
export function buildOrderEmailSubject(order: OrderForEmail, shop: ShopContacts = {}): string {
  return `${shopName(shop)}: заказ ${orderNumber(order)} принят`;
}

function greeting(order: OrderForEmail): string {
  const firstName = order.shipping_address?.first_name?.trim();
  return firstName ? `Здравствуйте, ${firstName}!` : "Здравствуйте!";
}

/** Название позиции с вариантом: «Пальто из шерсти, ONE SIZE». */
function itemName(item: OrderEmailItem): string {
  const title = item.title?.trim() || "без названия";
  const variant = item.variant_title?.trim();
  return variant ? `${title}, ${variant}` : title;
}

/**
 * Сумма товаров.
 *
 * `item_total` считает Medusa; `subtotal` — запасной вариант для заказов,
 * прочитанных без него. Перемножать цену на количество самим нельзя: скидки и
 * налог в эту арифметику не входят, и покупатель увидел бы сумму, которой нет
 * ни в одном документе.
 */
function itemsAmount(order: OrderForEmail): MoneyValue {
  return order.item_total ?? order.subtotal;
}

/** Способ доставки, как он назван в заказе. */
function deliveryMethod(order: OrderForEmail): string | undefined {
  return order.shipping_methods?.[0]?.name?.trim() || undefined;
}

/** Получатель и телефон одной строкой; пусто, если ни того, ни другого нет. */
function recipientLine(order: OrderForEmail): string | undefined {
  const name = customerName(order);
  const phone = order.shipping_address?.phone?.trim();
  const parts = [name === "—" ? undefined : name, phone].filter(Boolean);
  return parts.length > 0 ? `Получатель: ${parts.join(", ")}` : undefined;
}

function signatureLines(shop: ShopContacts): string[] {
  return [shopName(shop), shop.email?.trim(), shop.url?.trim()].filter(
    (line): line is string => Boolean(line),
  );
}

/**
 * Текстовая версия письма.
 *
 * Отправляется всегда рядом с HTML: часть почтовых клиентов и фильтров
 * показывает именно её, а письмо без текстовой части чаще попадает в спам.
 */
export function buildOrderEmailText(order: OrderForEmail, shop: ShopContacts = {}): string {
  const currency = order.currency_code ?? "RUB";
  const items = order.items ?? [];

  const lines: string[] = [
    greeting(order),
    "",
    `Мы получили ваш заказ ${orderNumber(order)} и начали его собирать.`,
    "",
    "Состав заказа:",
  ];

  if (items.length === 0) {
    // Такого быть не должно, но пустой раздел выглядел бы как ошибка вёрстки,
    // а покупатель должен понимать, что видит.
    lines.push("  позиции не переданы");
  } else {
    for (const item of items) {
      const quantity = item.quantity ?? 0;
      const price = `${quantity} × ${formatAmount(item.unit_price, currency)}`;
      const total =
        item.total === null || item.total === undefined
          ? ""
          : ` = ${formatAmount(item.total, currency)}`;
      lines.push(`  ${itemName(item)} — ${price}${total}`);
    }
  }

  lines.push(
    "",
    `Товары: ${formatAmount(itemsAmount(order), currency)}`,
    `Доставка: ${formatAmount(order.shipping_total, currency)}`,
    `Итого: ${formatAmount(order.total, currency)}`,
    "",
    "Доставка:",
  );

  const method = deliveryMethod(order);
  if (method) {
    lines.push(`  ${method}`);
  }
  lines.push(`  ${formatAddress(order.shipping_address)}`);

  const recipient = recipientLine(order);
  if (recipient) {
    lines.push(`  ${recipient}`);
  }

  lines.push("", "Что дальше:", `  ${WHAT_NEXT}`, "", CONTACT_INVITE, "", ...signatureLines(shop));

  return lines.join("\n");
}

/**
 * Экранирование для HTML-версии.
 *
 * В письмо попадают названия товаров и адрес, введённый покупателем. Кавычка
 * или угловая скобка в них сломала бы разметку, а специально составленное имя
 * — превратило бы письмо в площадку для чужого HTML.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const CELL = 'style="padding:8px 12px;border-bottom:1px solid #e5e5e5;"';
const CELL_RIGHT = 'style="padding:8px 12px;border-bottom:1px solid #e5e5e5;text-align:right;"';
const TOTAL_CELL = 'style="padding:6px 12px;"';
const TOTAL_CELL_RIGHT = 'style="padding:6px 12px;text-align:right;"';

/**
 * HTML-версия письма.
 *
 * Стили только инлайновые и только простые: почтовые клиенты вырезают `<style>`
 * и не умеют современную вёрстку, а таблица с рамками отображается везде
 * одинаково. Ради письма о заказе городить адаптивный шаблон незачем.
 */
export function buildOrderEmailHtml(order: OrderForEmail, shop: ShopContacts = {}): string {
  const currency = order.currency_code ?? "RUB";
  const items = order.items ?? [];
  const esc = escapeHtml;

  const rows =
    items.length === 0
      ? `<tr><td colspan="3" ${CELL}>позиции не переданы</td></tr>`
      : items
          .map((item) => {
            const quantity = item.quantity ?? 0;
            const total =
              item.total === null || item.total === undefined
                ? formatAmount(item.unit_price, currency)
                : formatAmount(item.total, currency);
            return (
              `<tr>` +
              `<td ${CELL}>${esc(itemName(item))}</td>` +
              `<td ${CELL_RIGHT}>${quantity} × ${esc(formatAmount(item.unit_price, currency))}</td>` +
              `<td ${CELL_RIGHT}>${esc(total)}</td>` +
              `</tr>`
            );
          })
          .join("");

  const totalsRow = (label: string, value: MoneyValue, bold = false) => {
    const text = esc(formatAmount(value, currency));
    const cell = bold ? `<strong>${text}</strong>` : text;
    const name = bold ? `<strong>${esc(label)}</strong>` : esc(label);
    return (
      `<tr><td ${TOTAL_CELL}>${name}</td>` +
      `<td ${TOTAL_CELL_RIGHT} colspan="2">${cell}</td></tr>`
    );
  };

  const deliveryLines = [
    deliveryMethod(order),
    formatAddress(order.shipping_address),
    recipientLine(order),
  ]
    .filter((line): line is string => Boolean(line))
    .map((line) => esc(line))
    .join("<br />");

  const signature = signatureLines(shop).map((line) => esc(line)).join("<br />");

  return [
    '<!doctype html><html lang="ru"><head><meta charset="utf-8" />',
    `<title>${esc(buildOrderEmailSubject(order, shop))}</title></head>`,
    '<body style="margin:0;padding:24px;background:#ffffff;color:#111111;' +
      'font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;">',
    `<p>${esc(greeting(order))}</p>`,
    `<p>Мы получили ваш заказ ${esc(orderNumber(order))} и начали его собирать.</p>`,
    '<table role="presentation" cellpadding="0" cellspacing="0" ' +
      'style="border-collapse:collapse;width:100%;max-width:560px;">',
    "<tbody>",
    rows,
    totalsRow("Товары", itemsAmount(order)),
    totalsRow("Доставка", order.shipping_total),
    totalsRow("Итого", order.total, true),
    "</tbody></table>",
    `<p><strong>Доставка</strong><br />${deliveryLines}</p>`,
    `<p><strong>Что дальше</strong><br />${esc(WHAT_NEXT)}</p>`,
    `<p>${esc(CONTACT_INVITE)}</p>`,
    `<p>${signature}</p>`,
    "</body></html>",
  ].join("");
}

/** Письмо целиком: тема, текст и HTML собираются из одного и того же заказа. */
export function buildOrderEmail(
  order: OrderForEmail,
  shop: ShopContacts = {},
): { subject: string; text: string; html: string } {
  return {
    subject: buildOrderEmailSubject(order, shop),
    text: buildOrderEmailText(order, shop),
    html: buildOrderEmailHtml(order, shop),
  };
}
