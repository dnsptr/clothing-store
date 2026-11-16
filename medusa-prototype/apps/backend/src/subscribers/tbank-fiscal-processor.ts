import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework";
import { TBANK_NOTIFICATION_MODULE } from "../modules/tbank-notifications";
import type FiscalStore from "../modules/tbank-notifications/service";
import type { FiscalReceiptRow } from "../modules/tbank-notifications/fiscal";
import { applyTbankFiscalReceipt } from "../modules/tbank/services/refund-operations";

export default async function tbankFiscalProcessor({ event, container }: SubscriberArgs<{ id: string }>) {
  if (!event.data?.id || typeof event.data.id !== "string") return;
  const store = container.resolve<FiscalStore>(TBANK_NOTIFICATION_MODULE);
  const rows: FiscalReceiptRow[] = await store.listTbankFiscalReceipts({ id: event.data.id });
  if (rows[0]) await applyTbankFiscalReceipt(container, rows[0]);
}
export const config: SubscriberConfig = {
  event: "tbank.fiscal.received", context: { subscriberId: "tbank-fiscal-processor" },
};
