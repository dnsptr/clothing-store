import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { Modules, PaymentWebhookEvents } from "@medusajs/framework/utils";

import { TBANK_NOTIFICATION_MODULE } from "../../../../modules/tbank-notifications";
import type TbankNotificationModuleService from "../../../../modules/tbank-notifications/service";
import { TBANK_PROVIDER_EVENT_ID } from "../../../../modules/tbank/provider-id";
import { parseNotification } from "../../../../modules/tbank/lib/status";
import { verifyNotificationToken } from "../../../../modules/tbank/lib/token";

/**
 * Приём нотификаций Т-Банка.
 *
 * Этот роут перекрывает штатный `/hooks/payment/:provider` для нашего
 * провайдера: сортировщик роутов Medusa ставит `static` раньше `params`
 * (`framework/dist/http/routes-sorter.js`), поэтому статический сегмент
 * `tbank` выигрывает у динамического `:provider`.
 *
 * Свой роут нужен потому, что штатный отвечает `200` **до** обработки, а её
 * откладывает на 5 секунд. Если она потом упадёт, банк об этом не узнает — он
 * уже получил подтверждение, и после трёх попыток BullMQ платёж молча теряется.
 *
 * Реализован гибридный вариант из §5.2: здесь синхронно проверяется подпись,
 * дедуплицируется и фиксируется факт, и только потом уходит `OK`. Тяжёлая
 * часть — `completeCart` и создание заказа — остаётся на штатном асинхронном
 * пути, который подписан на то же событие. Так «потерять платёж» невозможно,
 * а долгие операции не висят на TCP-соединении банка.
 *
 * Порядок операций здесь — не стилистика, а защита. Подпись проверяется до
 * записи в журнал: иначе кто угодно смог бы отправить выдуманную пару
 * `(PaymentId, Status)`, занять ею ключ дедупликации и заставить нас отбросить
 * настоящее уведомление как дубликат.
 */

/** Банк проверяет тело буквально: заглавными, без тегов и пробелов. */
const ACK_BODY = "OK";

/**
 * Задержка эмиссии события повторяет штатный роут. Она гасит гонку, в которой
 * уведомление приходит раньше, чем Medusa успела сохранить платёжную сессию:
 * покупатель может оплатить быстрее, чем завершится наш собственный запрос
 * `Init`.
 */
const WEBHOOK_DELAY_MS = 5000;
const WEBHOOK_ATTEMPTS = 3;

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const logger = req.scope.resolve("logger");
  const body = (req.body ?? {}) as Record<string, unknown>;

  const password = process.env.TBANK_PASSWORD;
  if (!password) {
    // Провайдер не настроен — принимать за него уведомления мы не вправе.
    logger.error("tbank webhook: TBANK_PASSWORD не задан, уведомление отброшено");
    res.status(503).send("payment provider is not configured");
    return;
  }

  // 1. Подпись. Несовпадение — не отвечаем `OK`: банк повторит, а мы не
  //    записываем ничего, что могло бы занять ключ дедупликации.
  if (!verifyNotificationToken(body, password)) {
    logger.warn(
      `tbank webhook: неверная подпись, OrderId=${String(body["OrderId"])}`,
    );
    res.status(401).send("invalid token");
    return;
  }

  // 2. Разбор. Битое тело с валидной подписью — это наша ошибка или смена
  //    контракта банка, и её надо видеть, а не проглатывать.
  let notification: ReturnType<typeof parseNotification>;
  try {
    notification = parseNotification(body);
  } catch (error) {
    logger.error(
      `tbank webhook: тело не разобрано: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    res.status(400).send("malformed notification");
    return;
  }

  const notifications = req.scope.resolve<TbankNotificationModuleService>(
    TBANK_NOTIFICATION_MODULE,
  );

  // 3. Дедупликация. Сначала дешёвая проверка, затем вставка, и повторная
  //    проверка при ошибке — уникальный индекс разводит два одновременных
  //    уведомления, которые «посмотреть, потом вставить» пропустило бы оба.
  const key = { payment_id: notification.paymentId, status: notification.status };

  const seen = await notifications.listTbankNotifications(key);
  if (seen.length > 0) {
    logger.info(
      `tbank webhook: повтор ${notification.status} по платежу ${notification.paymentId}, пропущен`,
    );
    res.send(ACK_BODY);
    return;
  }

  try {
    await notifications.createTbankNotifications({
      payment_id: notification.paymentId,
      status: notification.status,
      order_id: notification.orderId,
      amount_kopecks: notification.amountKopecks,
      success: notification.success,
      error_code: notification.errorCode ?? null,
      message: notification.message ?? null,
    });
  } catch (error) {
    // Проиграли гонку за уникальный индекс — это тот же дубликат.
    const raced = await notifications.listTbankNotifications(key);
    if (raced.length > 0) {
      logger.info(
        `tbank webhook: гонка на ${notification.status} по платежу ${notification.paymentId}, пропущен`,
      );
      res.send(ACK_BODY);
      return;
    }
    // Записать факт не удалось — отвечать `OK` нельзя, иначе банк не повторит.
    logger.error(
      `tbank webhook: журнал не записан: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    res.status(500).send("failed to record notification");
    return;
  }

  // 4. Факт зафиксирован — теперь можно отдавать обработку наружу. Событие
  //    повторяет форму штатного роута, потому что на него подписан штатный
  //    сабскрайбер, который и завершает корзину.
  try {
    const eventBus = req.scope.resolve(Modules.EVENT_BUS);
    await eventBus.emit(
      {
        name: PaymentWebhookEvents.WebhookReceived,
        data: {
          // Payment Module восстанавливает runtime id как `pp_${provider}`.
          // identifier сервиса `tbank` + config id `tbank` дают
          // `pp_tbank_tbank`, поэтому событие обязано нести оба сегмента.
          provider: TBANK_PROVIDER_EVENT_ID,
          payload: {
            data: req.body,
            rawData: req.rawBody,
            headers: req.headers,
          },
        },
      },
      { delay: WEBHOOK_DELAY_MS, attempts: WEBHOOK_ATTEMPTS },
    );
  } catch (error) {
    // Событие не поставилось в очередь. Факт при этом уже в БД, поэтому платёж
    // не потерян — его подберёт сверка (PAY-005). Банку отвечаем `OK`: повтор
    // ничего не изменит, ключ дедупликации уже занят.
    logger.error(
      `tbank webhook: событие не отправлено, платёж ${notification.paymentId} ждёт сверки: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  res.send(ACK_BODY);
};
