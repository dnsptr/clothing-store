import type { MedusaContainer } from "@medusajs/types";
import { PaymentReconcilerService } from "../modules/tbank/services/payment-reconciler";
import { sendPollManualReviewAlerts } from "../modules/tbank/services/poll-manual-review-alerts";

export default async function tbankReconcilerJob(container: MedusaContainer) {
  const logger = container.resolve("logger");
  try {
    const reconciler = new PaymentReconcilerService({ container });
    const result = await reconciler.processPendingBatch(20);
    if (result.claimed > 0) {
      logger.info(
        `tbank reconciler job: claimed and processed ${result.claimed} notification(s)`,
      );
    }
    const polled = await reconciler.pollMissingNotifications(10);
    if (polled.claimed > 0) {
      logger.info(
        `tbank reconciler job: checked ${polled.claimed} payment attempt(s) without a confirmed webhook`,
      );
    }
  } catch (error) {
    logger.error(
      `tbank reconciler job failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    throw error;
  } finally {
    try {
      const alerts = await sendPollManualReviewAlerts(container);
      if (alerts.sent > 0) {
        logger.info(`tbank reconciler job: delivered ${alerts.sent} payment review alert(s)`);
      }
    } catch (error) {
      logger.error(
        `tbank reconciler job: manual review alerts failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

export const config = {
  name: "tbank-payment-reconciliation",
  schedule: "* * * * *", // Recover stored notifications and poll older unresolved attempts
};
