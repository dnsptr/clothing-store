/**
 * Оповещение о новом заказе.
 *
 * До этого обработчика заказ не порождал ни одного уведомления: покупатель не
 * получал подтверждения, а менеджеры и логисты узнавали о заказе, только если
 * сами открывали админку. Для магазина, который собирается продавать, это
 * блокирующий пробел, а не удобство.
 *
 * Канал сейчас один — Telegram для сотрудников. Письмо покупателю добавляется
 * сюда же, когда будет выбран почтовый провайдер: сборка текста и получение
 * заказа от канала не зависят.
 */

import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework";
import type { INotificationModuleService, IOrderModuleService } from "@medusajs/types";
import { Modules } from "@medusajs/framework/utils";

import { buildNewOrderMessage, orderNumber, type OrderForMessage } from "../lib/order-message";

const STAFF_CHANNEL = "telegram";

export default async function orderPlacedHandler({
  event,
  container,
}: SubscriberArgs<{ id: string }>) {
  const logger = container.resolve("logger");
  const orderId = event.data?.id;

  if (!orderId) {
    return;
  }

  // Чат сотрудников задаётся переменной: список получателей — эксплуатационная
  // настройка, а не код. Пока он не задан, обработчик молча ничего не делает —
  // это рабочее состояние для разработки и CI.
  const staffChatId = process.env.TELEGRAM_CHAT_ID?.trim();
  if (!staffChatId) {
    return;
  }

  const orderService = container.resolve<IOrderModuleService>(Modules.ORDER);
  const notificationService = container.resolve<INotificationModuleService>(
    Modules.NOTIFICATION,
  );

  let order: OrderForMessage;
  try {
    order = (await orderService.retrieveOrder(orderId, {
      relations: ["items", "shipping_address", "shipping_methods"],
    })) as unknown as OrderForMessage;
  } catch (error) {
    logger.error(
      `order.placed: заказ ${orderId} не прочитан, уведомление не отправлено: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return;
  }

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

    logger.info(`order.placed: уведомление о заказе ${orderNumber(order)} отправлено`);
  } catch (error) {
    // Заказ уже создан и оплачен. Ронять обработчик нельзя: BullMQ будет
    // ретраить, а проблема, скорее всего, во внешнем сервисе.
    logger.error(
      `order.placed: не отправлено уведомление о заказе ${orderId}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

export const config: SubscriberConfig = {
  event: "order.placed",
  context: { subscriberId: "order-placed-staff-notification" },
};
