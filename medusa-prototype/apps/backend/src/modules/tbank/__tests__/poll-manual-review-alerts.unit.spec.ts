import type { MedusaContainer } from "@medusajs/types";
import { Modules } from "@medusajs/framework/utils";

import { TBANK_NOTIFICATION_MODULE } from "../../tbank-notifications";
import { sendPollManualReviewAlerts } from "../services/poll-manual-review-alerts";

const reviewAt = new Date("2026-09-27T15:00:00.000Z");
const attempt = { id: "tbatt_needs_review", order_id: "payses_needs_review", poll_manual_review_at: reviewAt };
const previousToken = process.env.TELEGRAM_BOT_TOKEN;
const previousChat = process.env.TELEGRAM_CHAT_ID;

afterAll(() => {
  if (previousToken === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
  else process.env.TELEGRAM_BOT_TOKEN = previousToken;
  if (previousChat === undefined) delete process.env.TELEGRAM_CHAT_ID;
  else process.env.TELEGRAM_CHAT_ID = previousChat;
});

function harness() {
  const store = {
    claimPendingPollReviewAlerts: jest.fn().mockResolvedValue([attempt]),
    markPollReviewAlertSent: jest.fn().mockResolvedValue([attempt]),
    releasePollReviewAlert: jest.fn().mockResolvedValue([attempt]),
  };
  const notifier = { createNotifications: jest.fn().mockResolvedValue([]) };
  const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  const container = {
    resolve: (name: string) => {
      if (name === TBANK_NOTIFICATION_MODULE) return store;
      if (name === Modules.NOTIFICATION) return notifier;
      if (name === "logger") return logger;
      throw new Error(`Unexpected dependency ${name}`);
    },
  } as unknown as MedusaContainer;
  return { store, notifier, logger, container };
}

describe("GetState manual-review alerts", () => {
  beforeEach(() => {
    process.env.TELEGRAM_BOT_TOKEN = "offline_bot_token";
    process.env.TELEGRAM_CHAT_ID = "-1001234567890";
  });

  it("keeps an unsent case in the database until a real recipient and transport are configured", async () => {
    const h = harness();
    delete process.env.TELEGRAM_CHAT_ID;
    expect(await sendPollManualReviewAlerts(h.container)).toEqual({
      claimed: 0, sent: 0, failed: 0, skipped: "telegram_unconfigured",
    });
    expect(h.store.claimPendingPollReviewAlerts).not.toHaveBeenCalled();
    expect(h.notifier.createNotifications).not.toHaveBeenCalled();

    process.env.TELEGRAM_CHAT_ID = "-1001234567890";
    expect(await sendPollManualReviewAlerts(h.container)).toEqual({ claimed: 1, sent: 1, failed: 0 });
    expect(h.store.markPollReviewAlertSent).toHaveBeenCalledTimes(1);
  });

  it("retries transport failure with the same review-epoch idempotency key before acknowledging delivery", async () => {
    const h = harness();
    h.notifier.createNotifications.mockRejectedValueOnce(new Error("Telegram unavailable"));
    expect(await sendPollManualReviewAlerts(h.container)).toEqual({ claimed: 1, sent: 0, failed: 1 });
    expect(h.store.markPollReviewAlertSent).not.toHaveBeenCalled();
    expect(h.store.releasePollReviewAlert).toHaveBeenCalledTimes(1);

    expect(await sendPollManualReviewAlerts(h.container)).toEqual({ claimed: 1, sent: 1, failed: 0 });
    const first = h.notifier.createNotifications.mock.calls[0]![0];
    const retried = h.notifier.createNotifications.mock.calls[1]![0];
    expect(retried.idempotency_key).toBe(first.idempotency_key);
    expect(retried).toEqual(expect.objectContaining({
      to: "-1001234567890",
      channel: "telegram",
      resource_id: attempt.id,
      content: expect.objectContaining({ text: expect.stringContaining(attempt.id) }),
    }));
    expect(h.store.markPollReviewAlertSent).toHaveBeenCalledTimes(1);
  });

  it("deduplicates a new retry after a DB failure but gives a subsequent review its own alert key", async () => {
    const h = harness();
    h.store.markPollReviewAlertSent.mockRejectedValueOnce(new Error("DB unavailable after delivery"));
    expect(await sendPollManualReviewAlerts(h.container)).toEqual({ claimed: 1, sent: 0, failed: 1 });
    expect(await sendPollManualReviewAlerts(h.container)).toEqual({ claimed: 1, sent: 1, failed: 0 });
    const deliveredKey = h.notifier.createNotifications.mock.calls[0]![0].idempotency_key;
    expect(h.notifier.createNotifications.mock.calls[1]![0].idempotency_key).toBe(deliveredKey);

    const nextReview = { ...attempt, poll_manual_review_at: new Date(reviewAt.getTime() + 3_600_000) };
    h.store.claimPendingPollReviewAlerts.mockResolvedValueOnce([nextReview]);
    expect(await sendPollManualReviewAlerts(h.container)).toEqual({ claimed: 1, sent: 1, failed: 0 });
    expect(h.notifier.createNotifications.mock.calls[2]![0].idempotency_key).not.toBe(deliveredKey);
  });
});
