import { randomUUID } from "node:crypto";
import type { INotificationModuleService, Logger, MedusaContainer } from "@medusajs/types";
import { Modules } from "@medusajs/framework/utils";

import { TBANK_NOTIFICATION_MODULE } from "../../tbank-notifications";

type ClaimedReview = {
  readonly id: string;
  readonly order_id: string;
  readonly poll_manual_review_at: Date;
};

type PollReviewAlertStore = {
  claimPendingPollReviewAlerts(input: {
    readonly limit: number;
    readonly now: Date;
    readonly leaseToken: string;
  }): Promise<readonly ClaimedReview[]>;
  markPollReviewAlertSent(input: {
    readonly id: string;
    readonly now: Date;
    readonly leaseToken: string;
  }): Promise<readonly ClaimedReview[]>;
  releasePollReviewAlert(input: {
    readonly id: string;
    readonly now: Date;
    readonly leaseToken: string;
  }): Promise<readonly ClaimedReview[]>;
};

export type PollReviewAlertResult = {
  readonly claimed: number;
  readonly sent: number;
  readonly failed: number;
  readonly skipped?: "telegram_unconfigured";
};

/** No claim is taken without a configured real transport: unsent reviews stay in the durable queue. */
export async function sendPollManualReviewAlerts(
  container: MedusaContainer,
  limit = 20,
): Promise<PollReviewAlertResult> {
  const chatId = process.env.TELEGRAM_CHAT_ID?.trim();
  const botToken = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!chatId || !botToken) {
    return { claimed: 0, sent: 0, failed: 0, skipped: "telegram_unconfigured" };
  }

  const logger = container.resolve<Logger>("logger");
  const store = container.resolve<PollReviewAlertStore>(TBANK_NOTIFICATION_MODULE);
  const notifier = container.resolve<INotificationModuleService>(Modules.NOTIFICATION);
  const leaseToken = randomUUID();
  const reviews = await store.claimPendingPollReviewAlerts({ limit, now: new Date(), leaseToken });
  let sent = 0;
  let failed = 0;

  for (const review of reviews) {
    try {
      const reviewAt = review.poll_manual_review_at;
      if (!(reviewAt instanceof Date) || Number.isNaN(reviewAt.getTime())) {
        throw new Error("Payment review has no valid transition timestamp");
      }
      await notifier.createNotifications({
        to: chatId,
        channel: "telegram",
        template: "tbank-payment-manual-review",
        content: {
          subject: "Т-Банк: платёж требует ручной проверки",
          text: `Попытка ${review.id} для сессии ${review.order_id} требует проверки. Откройте очередь ручного разбора Т-Банка в админке; не создавайте заказ и не возвращайте деньги до сверки с банком.`,
        },
        resource_id: review.id,
        resource_type: "tbank_payment_attempt",
        idempotency_key: `tbank-payment-manual-review:${review.id}:${reviewAt.toISOString()}`,
      });
      const marked = await store.markPollReviewAlertSent({ id: review.id, now: new Date(), leaseToken });
      if (marked.length === 0) {
        logger.warn(`tbank.manual_review: alert lease changed for attempt ${review.id}`);
      } else {
        sent++;
      }
    } catch (error) {
      failed++;
      logger.error(`tbank.manual_review: alert for attempt ${review.id} failed: ${error instanceof Error ? error.message : String(error)}`);
      try {
        await store.releasePollReviewAlert({ id: review.id, now: new Date(), leaseToken });
      } catch (releaseError) {
        logger.error(`tbank.manual_review: failed to release alert lease for attempt ${review.id}: ${releaseError instanceof Error ? releaseError.message : String(releaseError)}`);
      }
    }
  }

  return { claimed: reviews.length, sent, failed };
}
