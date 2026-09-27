import { GET as listReviews } from "../route";
import { GET as inspectReview } from "../[id]/route";
import { POST as retryReview } from "../[id]/retry/route";
import { POST as resolveReview } from "../[id]/resolve/route";
import { PaymentReconcilerService } from "../../../../../../modules/tbank/services/payment-reconciler";
import { PollReviewNotFoundError, PollReviewStateError } from "../../../../../../modules/tbank/services/poll-manual-review-operations";
import { PollReviewActionSchema } from "../validators";

function response() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn() };
}
function scope(store: Record<string, unknown> = {}) {
  return { resolve: jest.fn((key: string) => key === "tbankNotification" ? store :
    key === "logger" ? { error: jest.fn() } : key === "payment" ? {} : undefined) };
}
const actor = { actor_id: "staff_1" };
const params = { id: "tbatt_review" };
const validatedBody = { reason: "Verified bank reconciliation", expectedReviewAt: new Date("2026-09-28T12:00:00Z") };

describe("payment attempt manual review admin routes", () => {
  afterEach(() => jest.restoreAllMocks());

  it("requires a real review timestamp so a stale browser action cannot target a later quarantine", () => {
    expect(PollReviewActionSchema.safeParse({ reason: validatedBody.reason }).success).toBe(false);
    expect(PollReviewActionSchema.safeParse({ ...validatedBody, expectedReviewAt: "yesterday" }).success).toBe(false);
    expect(PollReviewActionSchema.parse({
      ...validatedBody, expectedReviewAt: validatedBody.expectedReviewAt.toISOString(),
    }).expectedReviewAt).toEqual(validatedBody.expectedReviewAt);
  });

  it("sorts/paginates only manual review rows and never serializes bank secrets", async () => {
    const listAndCountTbankPaymentAttempts = jest.fn().mockResolvedValue([[
      { id: params.id, poll_state: "manual_review", order_id: "payses_1", terminal_key: "secret-terminal",
        poll_lease_token: "secret-lease", poll_alert_lease_token: "secret-alert", raw_data: { token: "secret" } },
    ], 123]);
    const res = response();
    await Reflect.apply(listReviews, null, [{ scope: scope({ listAndCountTbankPaymentAttempts }),
      query: { offset: "3", limit: "1000" } }, res]);
    expect(listAndCountTbankPaymentAttempts).toHaveBeenCalledWith(
      { poll_state: "manual_review" },
      { skip: 3, take: 100, order: { poll_manual_review_at: "DESC", id: "DESC" } },
    );
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      count: 123, offset: 3, limit: 100,
      attempts: [expect.objectContaining({ id: params.id, order_id: "payses_1" })],
    }));
    const serialized = JSON.stringify(res.json.mock.calls[0][0]);
    expect(serialized).not.toContain("secret");
  });

  it("returns allowlisted detail with operator audit and safe session metadata", async () => {
    jest.spyOn(PaymentReconcilerService.prototype, "inspectPollReview").mockResolvedValue({
      paymentAttempt: { id: params.id, poll_state: "manual_review", terminal_key: "secret-terminal" },
      paymentSession: { id: "payses_1", status: "captured", amount: 500,
        data: { token: "secret-bank-payload" } } as never,
      actions: [{ id: "act_1", action: "retry", operator_id: "staff_1", reason: "Recheck", created_at: new Date() }],
    });
    const res = response();
    await Reflect.apply(inspectReview, null, [{ params, scope: scope() }, res]);
    expect(res.json).toHaveBeenCalledWith({ details: expect.objectContaining({
      paymentAttempt: expect.objectContaining({ id: params.id }),
      paymentSession: expect.objectContaining({ id: "payses_1", status: "captured", amount: 500 }),
      actions: [expect.objectContaining({ action: "retry", operator_id: "staff_1", reason: "Recheck" })],
    }) });
    expect(JSON.stringify(res.json.mock.calls[0][0])).not.toContain("secret");
  });

  it("requires an authenticated actor for either write and never invokes the reconciler without one", async () => {
    const retry = jest.spyOn(PaymentReconcilerService.prototype, "retryPollReview");
    const resolve = jest.spyOn(PaymentReconcilerService.prototype, "resolvePollReview");
    for (const operation of [retryReview, resolveReview]) {
      const res = response();
      await Reflect.apply(operation, null, [{ params, validatedBody, scope: scope() }, res]);
      expect(res.status).toHaveBeenCalledWith(401);
    }
    expect(retry).not.toHaveBeenCalled();
    expect(resolve).not.toHaveBeenCalled();
  });

  it.each([
    [new PollReviewNotFoundError(params.id), 404],
    [new PollReviewStateError(params.id), 409],
  ])("maps missing/stale detail and write actions to HTTP errors %#", async (error, status) => {
    jest.spyOn(PaymentReconcilerService.prototype, "inspectPollReview").mockRejectedValue(error);
    jest.spyOn(PaymentReconcilerService.prototype, "retryPollReview").mockRejectedValue(error);
    jest.spyOn(PaymentReconcilerService.prototype, "resolvePollReview").mockRejectedValue(error);
    for (const operation of [inspectReview, retryReview, resolveReview]) {
      const res = response();
      await Reflect.apply(operation, null, [{ params, validatedBody, auth_context: actor, scope: scope() }, res]);
      expect(res.status).toHaveBeenCalledWith(status);
    }
  });

  it("returns 404 for malformed attempt identifiers before any read or bank operation", async () => {
    const inspect = jest.spyOn(PaymentReconcilerService.prototype, "inspectPollReview");
    const resolve = jest.spyOn(PaymentReconcilerService.prototype, "resolvePollReview");
    const invalid = { params: { id: "../secrets" }, validatedBody, auth_context: actor, scope: scope() };
    for (const operation of [inspectReview, retryReview, resolveReview]) {
      const res = response();
      await Reflect.apply(operation, null, [invalid, res]);
      expect(res.status).toHaveBeenCalledWith(404);
    }
    expect(inspect).not.toHaveBeenCalled();
    expect(resolve).not.toHaveBeenCalled();
  });

  it("reports distinct retry and verified resolution states to the admin client", async () => {
    jest.spyOn(PaymentReconcilerService.prototype, "retryPollReview").mockResolvedValue();
    jest.spyOn(PaymentReconcilerService.prototype, "resolvePollReview").mockResolvedValue();
    const retryRes = response();
    await Reflect.apply(retryReview, null, [{ params, validatedBody, auth_context: actor, scope: scope() }, retryRes]);
    expect(retryRes.json).toHaveBeenCalledWith({ success: true, id: params.id, state: "pending" });
    const resolveRes = response();
    await Reflect.apply(resolveReview, null, [{ params, validatedBody, auth_context: actor, scope: scope() }, resolveRes]);
    expect(resolveRes.json).toHaveBeenCalledWith({ success: true, id: params.id, state: "complete", resolved: true });
    expect(PaymentReconcilerService.prototype.retryPollReview).toHaveBeenCalledWith(params.id,
      expect.objectContaining({ operatorId: actor.actor_id, expectedReviewAt: validatedBody.expectedReviewAt }));
    expect(PaymentReconcilerService.prototype.resolvePollReview).toHaveBeenCalledWith(params.id,
      expect.objectContaining({ operatorId: actor.actor_id, expectedReviewAt: validatedBody.expectedReviewAt }));
  });
});
