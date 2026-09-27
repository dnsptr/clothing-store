import type { PaymentSessionDTO } from "@medusajs/types";

import { resolvePollReview, retryPollReview, PollReviewStateError, type PollReviewStore } from "../services/poll-manual-review-operations";
import type { ReconciliationServices } from "../services/reconciliation-contracts";

const reviewAt = new Date("2026-09-28T12:00:00Z");
const attempt = {
  id: "tbatt_review", payment_session_id: "payses_review", provider_id: "pp_tbank_tbank",
  terminal_key: "term_review", order_id: "payses_review", expected_amount_kopecks: 50_000,
  currency_code: "rub", poll_state: "manual_review", poll_manual_review_at: reviewAt,
};
const session: PaymentSessionDTO = {
  id: attempt.payment_session_id, provider_id: attempt.provider_id,
  amount: 500, currency_code: "rub", status: "captured",
  data: { paymentId: "pay_review", orderId: attempt.order_id },
  payment_collection_id: "paycol_review",
  created_at: reviewAt, updated_at: reviewAt,
};
const confirmed = {
  Success: true, ErrorCode: "0", TerminalKey: "term_review", PaymentId: "pay_review",
  OrderId: "payses_review", Amount: 50_000, Status: "CONFIRMED",
};

function harness() {
  const store = {
    listTbankPaymentAttempts: jest.fn().mockResolvedValue([attempt]),
    listPollReviewActions: jest.fn().mockResolvedValue([]),
    retryPaymentAttemptManualReview: jest.fn(),
    resolvePaymentAttemptManualReview: jest.fn().mockResolvedValue([{ id: attempt.id }]),
  };
  const bank = { getState: jest.fn().mockResolvedValue(confirmed) };
  const linkageChecker = jest.fn().mockResolvedValue({ paymentCaptured: true, orderLinked: true, orderId: "order_review" });
  const query = { graph: jest.fn().mockResolvedValue({ data: [{ id: "order_review" }] }) };
  const services = {
    payment: { retrievePaymentSession: jest.fn().mockResolvedValue(session) },
    expectedTerminalKey: attempt.terminal_key, bank, linkageChecker, query,
  } as unknown as ReconciliationServices;
  return { store, services, bank, linkageChecker, query };
}

const action = { operatorId: "staff_review", reason: "Verified captured order and bank state", expectedReviewAt: reviewAt };
const lock = async <T>(_paymentId: string, operation: () => Promise<T>): Promise<T> => operation();

describe("payment attempt manual review resolution", () => {
  it("completes only after fresh CONFIRMED identity and amount proof plus captured existing-order linkage", async () => {
    const { store, services, bank, query } = harness();
    await resolvePollReview(store as PollReviewStore, services, attempt.id, action, lock);
    expect(bank.getState).toHaveBeenCalledTimes(1);
    expect(bank.getState).toHaveBeenCalledWith("pay_review");
    expect(query.graph).toHaveBeenCalledWith({ entity: "order", fields: ["id"], filters: { id: "order_review" } });
    expect(store.resolvePaymentAttemptManualReview).toHaveBeenCalledWith(expect.objectContaining({
      id: attempt.id, expectedReviewAt: reviewAt, operatorId: action.operatorId, reason: action.reason,
    }));
  });

  it.each([
    ["GetState outage", () => { throw new Error("network down"); }],
    ["unconfirmed bank payment", () => ({ ...confirmed, Status: "AUTHORIZED" })],
    ["mismatched amount", () => ({ ...confirmed, Amount: 49_999 })],
    ["mismatched terminal", () => ({ ...confirmed, TerminalKey: "wrong" })],
    ["unsuccessful GetState", () => ({ ...confirmed, Success: false })],
  ])("does not complete for %s", async (_scenario, response) => {
    const { store, services, bank } = harness();
    bank.getState.mockImplementation(response);
    await expect(resolvePollReview(store as PollReviewStore, services, attempt.id, action, lock))
      .rejects.toBeInstanceOf(PollReviewStateError);
    expect(store.resolvePaymentAttemptManualReview).not.toHaveBeenCalled();
  });

  it("rejects resolution when no GetState client is configured", async () => {
    const { store, services } = harness();
    const withoutBank = { ...services, bank: undefined };
    await expect(resolvePollReview(store as PollReviewStore, withoutBank, attempt.id, action, lock))
      .rejects.toBeInstanceOf(PollReviewStateError);
    expect(store.resolvePaymentAttemptManualReview).not.toHaveBeenCalled();
  });

  it("rejects an uncaptured payment or missing real order after confirmed GetState", async () => {
    const { store, services, linkageChecker, query } = harness();
    linkageChecker.mockResolvedValueOnce({ paymentCaptured: false, orderLinked: true, orderId: "order_review" });
    await expect(resolvePollReview(store as PollReviewStore, services, attempt.id, action, lock))
      .rejects.toBeInstanceOf(PollReviewStateError);
    query.graph.mockResolvedValueOnce({ data: [] });
    await expect(resolvePollReview(store as PollReviewStore, services, attempt.id, action, lock))
      .rejects.toBeInstanceOf(PollReviewStateError);
    expect(store.resolvePaymentAttemptManualReview).not.toHaveBeenCalled();
  });

  it("rejects changed review epoch or a concurrent zero-row conditional update", async () => {
    const { store, services, bank } = harness();
    store.listTbankPaymentAttempts.mockResolvedValueOnce([attempt]).mockResolvedValueOnce([{
      ...attempt, poll_manual_review_at: new Date(reviewAt.getTime() + 1_000),
    }]);
    await expect(resolvePollReview(store as PollReviewStore, services, attempt.id, action, lock))
      .rejects.toBeInstanceOf(PollReviewStateError);
    expect(bank.getState).not.toHaveBeenCalled();
    store.listTbankPaymentAttempts.mockResolvedValue([attempt]);
    store.resolvePaymentAttemptManualReview.mockResolvedValueOnce([]);
    await expect(resolvePollReview(store as PollReviewStore, services, attempt.id, action, lock))
      .rejects.toBeInstanceOf(PollReviewStateError);
  });

  it("cannot close a new review from an earlier browser tab before contacting the bank", async () => {
    const { store, services, bank } = harness();
    store.listTbankPaymentAttempts.mockResolvedValue([{
      ...attempt, poll_manual_review_at: new Date(reviewAt.getTime() + 1_000),
    }]);
    await expect(resolvePollReview(store as PollReviewStore, services, attempt.id, action, lock))
      .rejects.toBeInstanceOf(PollReviewStateError);
    expect(bank.getState).not.toHaveBeenCalled();
    expect(store.resolvePaymentAttemptManualReview).not.toHaveBeenCalled();
  });

  it("preserves a retired-terminal review instead of hiding it in an unclaimable pending state", async () => {
    const { store } = harness();
    await expect(retryPollReview(store as PollReviewStore, attempt.id, action, "new_terminal"))
      .rejects.toBeInstanceOf(PollReviewStateError);
    await expect(retryPollReview(store as PollReviewStore, attempt.id, action, ""))
      .rejects.toBeInstanceOf(PollReviewStateError);
    expect(store.retryPaymentAttemptManualReview).not.toHaveBeenCalled();
  });

  it("requires the displayed review epoch for retry and preserves the original terminal in SQL", async () => {
    const { store } = harness();
    await expect(retryPollReview(store as PollReviewStore, attempt.id, {
      ...action, expectedReviewAt: new Date(reviewAt.getTime() - 1_000),
    }, attempt.terminal_key)).rejects.toBeInstanceOf(PollReviewStateError);
    expect(store.retryPaymentAttemptManualReview).not.toHaveBeenCalled();

    store.retryPaymentAttemptManualReview.mockResolvedValueOnce([{ id: attempt.id }]);
    await retryPollReview(store as PollReviewStore, attempt.id, action, attempt.terminal_key);
    expect(store.retryPaymentAttemptManualReview).toHaveBeenCalledWith(expect.objectContaining({
      terminalKey: attempt.terminal_key, expectedReviewAt: reviewAt, operatorId: action.operatorId,
    }));
  });
});
