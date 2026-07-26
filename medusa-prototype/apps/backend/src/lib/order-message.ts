/**
 * Текст уведомления о новом заказе.
 *
 * Вынесено из подписчика отдельной чистой функцией по той же причине, что и
 * функции Т-Банка: провайдер доставки сообщений (Telegram, почта, что угодно
 * дальше) сменится, а требования к содержанию — нет. Здесь их и тестируем,
 * без сети и без контейнера.
 *
 * Содержание продиктовано тем, кто это читает. Менеджеру и логисту нужно
 * понять заказ, не открывая админку: что купили, куда везти, с кем связаться и
 * сколько денег ждать. Покупателю — подтверждение, что заказ принят.
 */

/** Минимум полей заказа, от которого зависит текст. */
export type OrderForMessage = {
  id: string;
  display_id?: number | null;
  email?: string | null;
  currency_code?: string | null;
  total?: number | string | null;
  items?: Array<{
    title?: string | null;
    variant_title?: string | null;
    quantity?: number | null;
    unit_price?: number | string | null;
  }> | null;
  shipping_address?: {
    first_name?: string | null;
    last_name?: string | null;
    phone?: string | null;
    city?: string | null;
    address_1?: string | null;
    postal_code?: string | null;
  } | null;
  shipping_methods?: Array<{ name?: string | null }> | null;
};

/**
 * Сумма к показу.
 *
 * `null`/`undefined` превращается в прочерк, а не в «0 ₽»: ноль — это
 * утверждение о деньгах, и в уведомлении о заказе оно означало бы бесплатный
 * заказ. Отсутствие суммы — это отсутствие суммы, и менеджер должен увидеть
 * именно его.
 */
export function formatAmount(
  value: number | string | null | undefined,
  currency = "RUB",
): string {
  if (value === null || value === undefined || value === "") return "—";
  const numeric = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(numeric)) return "—";

  const symbol = currency.toUpperCase() === "RUB" ? "₽" : currency.toUpperCase();
  const formatted = numeric.toLocaleString("ru-RU", {
    minimumFractionDigits: Number.isInteger(numeric) ? 0 : 2,
    maximumFractionDigits: 2,
  });

  // Русская локаль разделяет разряды неразрывным пробелом (U+00A0), а часть
  // сборок ICU — узким неразрывным (U+202F). Приводим к обычному пробелу:
  // иначе вывод зависит от версии Node на конкретной машине, и одно и то же
  // сообщение выглядит по-разному в логах, тестах и Telegram.
  return `${formatted.replace(/[  ]/g, " ")} ${symbol}`;
}

/** Номер заказа для человека: display_id, если он есть, иначе внутренний id. */
export function orderNumber(order: OrderForMessage): string {
  return order.display_id ? `№${order.display_id}` : order.id;
}

function customerName(order: OrderForMessage): string {
  const address = order.shipping_address;
  const parts = [address?.first_name, address?.last_name].filter(Boolean);
  return parts.length > 0 ? parts.join(" ") : "—";
}

function deliveryLine(order: OrderForMessage): string {
  const address = order.shipping_address;
  const method = order.shipping_methods?.[0]?.name?.trim();

  // Адрес собирается из того, что реально заполнено. Пустые поля не
  // превращаются в запятые подряд: логист должен видеть, что данных нет, а не
  // разбирать пунктуацию.
  const addressParts = [address?.postal_code, address?.city, address?.address_1]
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part));

  const destination = addressParts.length > 0 ? addressParts.join(", ") : "адрес не указан";
  return method ? `${method} — ${destination}` : destination;
}

/**
 * Сообщение менеджеру о новом заказе.
 *
 * Формат — простой текст. Разметку намеренно не используем: сообщение уходит в
 * Telegram, а в разметке пришлось бы экранировать имена и адреса покупателей,
 * и первый же клиент с подчёркиванием в фамилии сломал бы отправку.
 */
export function buildNewOrderMessage(order: OrderForMessage): string {
  const currency = order.currency_code ?? "RUB";

  const lines: string[] = [
    `Новый заказ ${orderNumber(order)}`,
    "",
    `Покупатель: ${customerName(order)}`,
    `Телефон: ${order.shipping_address?.phone?.trim() || "—"}`,
    `Почта: ${order.email?.trim() || "—"}`,
    "",
    `Доставка: ${deliveryLine(order)}`,
    "",
    "Состав:",
  ];

  const items = order.items ?? [];
  if (items.length === 0) {
    lines.push("  позиции не переданы");
  } else {
    for (const item of items) {
      const title = item.title?.trim() || "без названия";
      const variant = item.variant_title?.trim();
      const quantity = item.quantity ?? 0;
      const name = variant ? `${title}, ${variant}` : title;
      lines.push(`  ${name} × ${quantity} — ${formatAmount(item.unit_price, currency)}`);
    }
  }

  lines.push("", `Итого: ${formatAmount(order.total, currency)}`);

  return lines.join("\n");
}
