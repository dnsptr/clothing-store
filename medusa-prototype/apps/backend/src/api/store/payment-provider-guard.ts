import type { MedusaNextFunction, MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { MedusaError } from "@medusajs/framework/utils";
import { revalidateCheckoutDeliveryForPayment } from "../../lib/checkout-delivery";
import { CART_FIELDS, type ReceiptQuery } from "../../modules/tbank/lib/receipt-source";
import { isFullyCaptured, type PaymentEvidence } from "../../lib/prepaid-order";
import { TBANK_NOTIFICATION_MODULE } from "../../modules/tbank-notifications";
import type TbankNotificationModuleService from "../../modules/tbank-notifications/service";
import { TBANK_PAYMENT_PROVIDER_ID } from "../../modules/tbank/provider-id";
import { blocksNextOperation } from "../../modules/tbank/lib/refund-ledger";

// Medusa accepts payment sessions for pp_system_default even when that provider
// is not linked to the cart's region. The provider completes orders without
// charging; a 100%-prepaid storefront must reject it at the write boundary.
export function requirePaidPaymentProvider(
  req: MedusaRequest,
  res: MedusaResponse,
  next: MedusaNextFunction,
): void {
  const body = req.body as { provider_id?: unknown } | undefined;
  if (body?.provider_id === "pp_system_default") {
    res.status(400).json({ message: "Бесплатный системный провайдер недоступен для оформления заказа" });
    return;
  }
  next();
}

/** Access middleware has already bound this collection to the shopper's cart. */
export async function requireCheckoutDelivery(
  req: MedusaRequest,
  _res: MedusaResponse,
  next: MedusaNextFunction,
): Promise<void> {
  const query = req.scope.resolve<ReceiptQuery>("query");
  const links = await query.graph<{ cart_id: string }>({
    entity: "cart_payment_collection", fields: ["cart_id"],
    filters: { payment_collection_id: req.params.id },
  });
  const cartId = links.data[0]?.cart_id;
  if (links.data.length !== 1 || !cartId) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "Корзина платёжной коллекции не найдена");
  }
  const body = req.body as { data?: { expected_total?: unknown } };
  const expectedTotal = body?.data?.expected_total;
  if (typeof expectedTotal !== "number" || !Number.isFinite(expectedTotal)) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "Подтвердите итоговую сумму заказа");
  }
  await revalidateCheckoutDeliveryForPayment(req.scope, cartId, expectedTotal);
  next();
}

/** Store API must not turn a pending bank redirect into an unpaid order. */
export async function requireCapturedCart(
  req: MedusaRequest,
  _res: MedusaResponse,
  next: MedusaNextFunction,
): Promise<void> {
  const query = req.scope.resolve<ReceiptQuery>("query");
  const { data } = await query.graph<{
    id: string; total: number; payment_collection?: { payments?: PaymentEvidence[] };
  }>({
    entity: "cart",
    fields: [...CART_FIELDS, "payment_collection.payments.captures.amount", "payment_collection.payments.refunds.amount"],
    filters: { id: req.params.id },
  });
  const cart = data[0];
  if (data.length !== 1 || cart?.id !== req.params.id || !isFullyCaptured(cart.total, cart.payment_collection?.payments)) {
    throw new MedusaError(MedusaError.Types.CONFLICT, "Заказ нельзя завершить до подтверждения полной оплаты банком");
  }
  next();
}

/** Creating a carrier application from the Admin is an irreversible operation. */
export async function requirePaidOrderForFulfillment(
  req: MedusaRequest,
  _res: MedusaResponse,
  next: MedusaNextFunction,
): Promise<void> {
  const query = req.scope.resolve<ReceiptQuery>("query");
  const { data } = await query.graph<{
    id: string; total: number; canceled_at?: Date | null;
    payment_collections?: Array<{ payments?: Array<PaymentEvidence & { id: string; provider_id: string }> }>;
  }>({
    entity: "order",
    fields: ["*", "items.*", "items.tax_lines.*", "items.adjustments.*",
      "shipping_methods.*", "shipping_methods.tax_lines.*", "shipping_methods.adjustments.*",
      "payment_collections.payments.id", "payment_collections.payments.provider_id",
      "payment_collections.payments.captures.amount", "payment_collections.payments.refunds.amount"],
    filters: { id: req.params.id },
  });
  const order = data[0];
  const payments = order?.payment_collections?.flatMap(collection => collection.payments ?? []);
  if (data.length !== 1 || order?.id !== req.params.id || order.canceled_at || !isFullyCaptured(order.total, payments)) {
    throw new MedusaError(MedusaError.Types.CONFLICT, "Сборка и передача в доставку доступны только после полной оплаты заказа");
  }
  const bankPaymentIds: string[] = [];
  for (const payment of payments ?? []) {
    if (payment.provider_id === TBANK_PAYMENT_PROVIDER_ID) bankPaymentIds.push(payment.id);
  }
  if (bankPaymentIds.length) {
    const journal = req.scope.resolve<TbankNotificationModuleService>(TBANK_NOTIFICATION_MODULE);
    const operations = await journal.listTbankRefundOperations({ payment_id: bankPaymentIds }, {
      select: ["kind", "state", "fiscal_state", "native_refund_id"],
    });
    if (operations.some(blocksNextOperation)) {
      throw new MedusaError(MedusaError.Types.CONFLICT, "Передача заказа заблокирована до завершения денежной и кассовой сверки");
    }
  }
  next();
}
