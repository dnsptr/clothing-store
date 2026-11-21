import type { MedusaContainer } from "@medusajs/types";
import { PaymentReconcilerService } from "../modules/tbank/services/payment-reconciler";

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
    const polls = await reconciler.processMissingWebhookBatch(5);
    if (polls.claimed > 0) {
      logger.info(`tbank reconciler job: checked ${polls.claimed} overdue payment attempt(s)`);
    }
  } catch (error) {
    logger.error(
      `tbank reconciler job failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    throw error;
  }
}

export const config = {
  name: "tbank-payment-reconciliation",
  schedule: "* * * * *", // Recover webhook inbox and due payment attempts each minute.
};
