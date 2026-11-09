import type { MedusaContainer } from "@medusajs/framework/types";
import { CHECKOUT_HOLD_MODULE } from "../modules/checkout-holds/contracts";
import type CheckoutHoldModuleService from "../modules/checkout-holds/service";
import { TBANK_NOTIFICATION_MODULE } from "../modules/tbank-notifications";
import { parseTbankEnvironment } from "../modules/tbank/config";
import { TBankApiError, TBankClient } from "../modules/tbank/lib/client";
import { TBANK_PAYMENT_PROVIDER_ID } from "../modules/tbank/provider-id";
import type { TbankNotificationStore } from "../modules/tbank/services/reconciliation-contracts";

export default async function checkoutHoldExpiry(container: MedusaContainer) {
  const holds = container.resolve<CheckoutHoldModuleService>(CHECKOUT_HOLD_MODULE);
  await holds.expirePaymentHolds();
  const configuration = parseTbankEnvironment(process.env);
  if (!configuration.enabled) return;
  const notifications = container.resolve<Required<Pick<TbankNotificationStore, "listTbankPaymentAttempts">>>(TBANK_NOTIFICATION_MODULE);
  const bank = new TBankClient(configuration.options);
  for (const hold of await holds.claimExpiredPaymentHolds()) {
    const attempts = await notifications.listTbankPaymentAttempts({ payment_session_id: hold.payment_session_id });
    if (attempts.some(attempt => attempt.terminal_key !== configuration.options.terminalKey ||
        attempt.provider_id !== TBANK_PAYMENT_PROVIDER_ID)) continue;
    try {
      const order = await bank.checkOrder(hold.payment_session_id);
      if (order.OrderId === hold.payment_session_id && Array.isArray(order.Payments) && order.Payments.length === 0) {
        await holds.releasePaymentHold(hold.payment_session_id);
      }
      // Existing bank payments belong to the signed webhook/GetState reconciler.
      // A local timeout alone must never make their stock available again.
    } catch (error) {
      // https://developer.tbank.ru/eacq/intro/errors/error-codes: 407 = not found.
      if (error instanceof TBankApiError && error.method === "CheckOrder" && error.errorCode === "407") {
        await holds.releasePaymentHold(hold.payment_session_id);
      } else {
        container.resolve("logger").warn(`checkout hold ${hold.id}: bank result is unresolved; allocation retained`);
      }
    }
  }
}

export const config = { name: "checkout-online-hold-expiry", schedule: "* * * * *" };
