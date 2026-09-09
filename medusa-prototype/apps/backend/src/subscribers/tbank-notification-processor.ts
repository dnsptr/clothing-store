import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework";
import { PaymentReconcilerService } from "../modules/tbank/services/payment-reconciler";

export default async function tbankNotificationProcessor({
  event,
  container,
}: SubscriberArgs<{ id: string }>) {
  const notificationId = event.data?.id;
  if (!notificationId || typeof notificationId !== "string") {
    return;
  }

  const logger = container.resolve("logger");
  try {
    const reconciler = new PaymentReconcilerService({ container });
    await reconciler.processNotification(notificationId);
  } catch (error) {
    logger.error(
      `tbank notification processor subscriber failed for ${notificationId}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

export const config: SubscriberConfig = {
  event: "tbank.notification.received",
  context: {
    subscriberId: "tbank-notification-processor",
  },
};
