/**
 * Оповещает сотрудников и покупателя только после проверки, что списание
 * Т-Банка и связь заказа с корзиной сохранены. Событие `order.placed` Medusa
 * публикует раньше авторизации платежа, поэтому по нему письма отправлять нельзя.
 *
 * Каналы независимы: ошибка Telegram не препятствует попытке отправить письмо.
 */

import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework";
import type { INotificationModuleService, IOrderModuleService } from "@medusajs/types";
import { Modules } from "@medusajs/framework/utils";

import { buildOrderEmail, extractEmailAddress, type OrderForEmail } from "../lib/order-email";
import { buildNewOrderMessage, orderNumber } from "../lib/order-message";

const STAFF_CHANNEL = "telegram";
const CUSTOMER_CHANNEL = "email";

/**
 * Поля заказа, которые нужны уведомлениям.
 *
 * Суммы (`total`, `item_total`, `shipping_total`) обязаны быть здесь: модуль
 * заказов считает тоталы, только если хотя бы одно такое поле указано в
 * `select` (`shouldIncludeTotals`). Без этого списка заказ приезжает без денег
 * вообще, и в письме покупателю на месте итога стоял бы прочерк.
 */
const ORDER_FIELDS = [
  "id",
  "display_id",
  "email",
  "currency_code",
  "total",
  "item_total",
  "shipping_total",
];

/** Позиции, адрес и способ доставки — всё, из чего состоит сообщение. */
const ORDER_RELATIONS = ["items", "shipping_address", "shipping_methods"];

export default async function orderPlacedHandler({
  event,
  container,
}: SubscriberArgs<{ id: string }>) {
  const logger = container.resolve("logger");
  const orderId = event.data?.id;

  if (!orderId) {
    return;
  }

  const orderService = container.resolve<IOrderModuleService>(Modules.ORDER);
  const notificationService = container.resolve<INotificationModuleService>(
    Modules.NOTIFICATION,
  );

  let order: OrderForEmail;
  try {
    order = (await orderService.retrieveOrder(orderId, {
      select: ORDER_FIELDS,
      relations: ORDER_RELATIONS,
    })) as unknown as OrderForEmail;
  } catch (error) {
    logger.error(
      `tbank.order.paid: заказ ${orderId} не прочитан, уведомления не отправлены: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return;
  }

  // Чат сотрудников задаётся переменной: список получателей — эксплуатационная
  // настройка, а не код. Пока он не задан, сообщение в Telegram не уходит —
  // это рабочее состояние для разработки и CI.
  const staffChatId = process.env.TELEGRAM_CHAT_ID?.trim();
  if (staffChatId) {
    try {
      await notificationService.createNotifications({
        to: staffChatId,
        channel: STAFF_CHANNEL,
        // Шаблонов у Telegram нет: текст собран заранее чистой функцией.
        template: "order-placed",
        content: {
          subject: `Новый заказ ${orderNumber(order)}`,
          text: buildNewOrderMessage(order),
        },
        // Привязка к заказу — чтобы по истории уведомлений можно было ответить
        // на вопрос «отправляли ли мы что-нибудь по этому заказу».
        resource_id: orderId,
        resource_type: "order",
        // Идемпотентность на стороне модуля уведомлений: повторная обработка
        // события не должна давать второе сообщение об одном заказе.
        idempotency_key: `order-placed:${orderId}:${STAFF_CHANNEL}`,
      });

      logger.info(`tbank.order.paid: уведомление о заказе ${orderNumber(order)} передано провайдеру`);
    } catch (error) {
      logger.error(
        `tbank.order.paid: не отправлено уведомление о заказе ${orderId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  const customerEmail = order.email?.trim();
  if (!customerEmail) {
    // Заказ без почты — не ошибка обработчика: писать некому, и сказать об
    // этом можно только в лог.
    logger.warn(`tbank.order.paid: у заказа ${orderId} нет почты, письмо не отправлено`);
    return;
  }

  try {
    // Проверки переменных SMTP здесь нет намеренно, в отличие от Telegram:
    // канал `email` обслуживает `notification-local`, когда почта не настроена,
    // и он пишет письмо в лог. Так цепочка «заказ → письмо» проверяется в
    // разработке и в CI целиком, без почтового хостинга.
    const email = buildOrderEmail(order, {
      // Контакты берутся из окружения: адрес отправителя и адрес витрины на
      // разных стендах разные, а выдуманный в коде ящик увёл бы письма
      // покупателей в никуда.
      email: extractEmailAddress(process.env.SMTP_FROM),
      url: process.env.STOREFRONT_URL,
    });

    await notificationService.createNotifications({
      to: customerEmail,
      channel: CUSTOMER_CHANNEL,
      // Шаблон именованный, но рисует письмо не провайдер: текст и HTML
      // собраны здесь же чистой функцией, провайдер остаётся транспортом.
      template: "order-placed",
      content: {
        subject: email.subject,
        text: email.text,
        html: email.html,
      },
      resource_id: orderId,
      resource_type: "order",
      idempotency_key: `order-placed:${orderId}:${CUSTOMER_CHANNEL}`,
    });

    logger.info(`tbank.order.paid: письмо о заказе ${orderNumber(order)} передано провайдеру`);
  } catch (error) {
    logger.error(
      `tbank.order.paid: не отправлено письмо о заказе ${orderId}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

export const config: SubscriberConfig = {
  event: "tbank.order.paid",
  context: { subscriberId: "order-placed-notifications" },
};
