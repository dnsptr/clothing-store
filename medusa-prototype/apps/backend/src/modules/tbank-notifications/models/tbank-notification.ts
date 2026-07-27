import { model } from "@medusajs/framework/utils";

/**
 * Журнал обработанных нотификаций Т-Банка.
 *
 * Существует ради одного свойства: **обработать пару `(PaymentId, Status)`
 * ровно один раз**. Причина в правилах доставки банка (docs/design/
 * tbank-payments-and-fiscalization.md, §5.2): если мы не ответили `HTTP 200` с
 * телом `OK`, уведомление шлётся заново раз в час сутки, затем раз в сутки
 * месяц. Один платёж может прийти десятки раз.
 *
 * Ключ именно пара, а не `PaymentId`: при одностадийной оплате по одному
 * платежу штатно приходят два разных уведомления — `AUTHORIZED` и `CONFIRMED`
 * (§3). Дедупликация по одному `PaymentId` проглотила бы второе и потеряла
 * факт списания.
 *
 * Запись создаётся **до** ответа `OK` и до эмиссии события, поэтому «потерять
 * платёж» между подтверждением и обработкой невозможно.
 */
const TbankNotification = model
  .define(
    { name: "TbankNotification", tableName: "tbank_notification" },
    {
      id: model.id({ prefix: "tbnotif" }).primaryKey(),
      /** `PaymentId` банка. Приходит и числом, и строкой — храним строкой. */
      payment_id: model.text(),
      /** Статус Т-Банка: `AUTHORIZED`, `CONFIRMED`, `REJECTED`… */
      status: model.text(),
      /** `OrderId` — идентификатор платёжной сессии Medusa (§5.3). */
      order_id: model.text(),
      /**
       * Сумма в копейках, как её прислал банк. Храним в исходных единицах
       * намеренно: это сырой факт для сверки (PAY-005), а не деньги для
       * расчётов. Любая конверсия здесь потеряла бы то, что реально пришло.
       */
      amount_kopecks: model.number(),
      success: model.boolean(),
      error_code: model.text().nullable(),
      message: model.text().nullable(),
    },
  )
  .indexes([
    // Собственно дедупликация. Уникальность на уровне БД, а не проверкой в
    // коде: при одностадийной оплате банк шлёт два уведомления одновременно,
    // и проверка «сначала посмотреть, потом вставить» их не разведёт.
    {
      on: ["payment_id", "status"],
      unique: true,
      where: "deleted_at IS NULL",
    },
    // Поиск по сессии — для сверки и для разбора инцидентов.
    { on: ["order_id"] },
  ]);

export default TbankNotification;
