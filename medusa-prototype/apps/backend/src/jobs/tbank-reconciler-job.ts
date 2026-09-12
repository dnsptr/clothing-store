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
  schedule: "* * * * *", // Run every minute for recovery of leased/pending notifications
};
