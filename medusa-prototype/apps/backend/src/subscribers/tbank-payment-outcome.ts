import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework";
import type { IPaymentModuleService, ProviderWebhookPayload } from "@medusajs/types";
import { Modules, PaymentWebhookEvents } from "@medusajs/framework/utils";

/**
 * Отражение неуспешных исходов платежа.
 *
 * Штатный сабскрайбер `payment-webhook` начинается с раннего `return` на пяти
 * значениях `PaymentActions` из восьми — среди них `failed` и `canceled`
 * (`@medusajs/medusa/dist/subscribers/payment-webhook.js`). Это значит, что
 * отказ банка не отражается **нигде**: сессия остаётся в том же состоянии,
 * событий нет, корзина висит до истечения, а менеджер видит «оплата в
 * процессе» на платеже, которого не будет (§4.4).
 *
 * Здесь закрывается именно этот пробел. Успешные исходы намеренно не трогаем:
 * их ведёт штатный путь, и дублировать `completeCart` своими руками не нужно.
 *
 * Дедупликация тоже не нужна: она уже произошла в роуте
 * (`src/api/hooks/payment/tbank/route.ts`) до того, как это событие возникло.
 */
export default async function tbankPaymentOutcomeHandler({
  event,
  container,
}: SubscriberArgs<{ provider: string; payload: ProviderWebhookPayload["payload"] }>) {
  const input = event.data;

  // Событие общее для всех провайдеров — чужие пропускаем.
  if (input?.provider !== "tbank") {
    return;
  }

  const logger = container.resolve("logger");
  const paymentService = container.resolve<IPaymentModuleService>(Modules.PAYMENT);

  // Разбор и проверку подписи делает сам провайдер. Повторно здесь их не
  // выполняем: единственное место, где живёт таблица §4.3, — это провайдер.
  const processed = await paymentService.getWebhookActionAndData(input);

  if (processed.action !== "failed" && processed.action !== "canceled") {
    return;
  }

  const sessionId = processed.data?.session_id;
  if (!sessionId) {
    return;
  }

  // `failed` — это ошибка платежа (отказ банка, истёкший срок), `canceled` —
  // осознанная отмена. Medusa различает их разными состояниями сессии, и
  // смешивать их не стоит: по ним потом разбирают, почему заказа нет.
  const status = processed.action === "failed" ? "error" : "canceled";

  try {
    const session = await paymentService.retrievePaymentSession(String(sessionId));

    await paymentService.updatePaymentSession({
      id: session.id,
      // Поля обязательны контрактом `UpdatePaymentSessionDTO`, поэтому
      // переносим текущие значения без изменений — меняем только статус.
      data: session.data ?? {},
      currency_code: session.currency_code,
      amount: session.amount,
      status,
    });

    logger.info(
      `tbank: сессия ${session.id} переведена в ${status} по нотификации банка`,
    );
  } catch (error) {
    // Сессии может уже не быть — например, корзина истекла раньше уведомления.
    // Это не повод ронять обработчик: факт нотификации уже записан в журнал.
    logger.warn(
      `tbank: не удалось отразить исход ${processed.action} для сессии ${String(sessionId)}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

export const config: SubscriberConfig = {
  event: PaymentWebhookEvents.WebhookReceived,
  context: {
    // Свой id, иначе мы перезаписали бы штатный обработчик успешных исходов.
    subscriberId: "tbank-payment-outcome-handler",
  },
};
