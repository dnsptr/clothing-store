import { GET as listManualReviews } from "../route";
import { GET as inspectManualReview } from "../[id]/route";
import { POST as retryManualReview } from "../[id]/retry/route";
import { POST as resolveManualReview } from "../[id]/resolve/route";
import { ManualReviewListQuerySchema } from "../validators";
import { PaymentReconcilerService } from "../../../../../modules/tbank/services/payment-reconciler";
import {
  ManualReviewNotFoundError,
  ManualReviewStateError,
} from "../../../../../modules/tbank/services/manual-review-operations";

function responseHarness() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  };
}

function scopeHarness(notificationService: Record<string, unknown> = {}) {
  return {
    resolve: jest.fn((name: string) => {
      if (name === "tbankNotification") return notificationService;
      if (name === "logger") return { error: jest.fn() };
      if (name === "payment") return {};
      return undefined;
    }),
  };
}

describe("manual review admin route contracts", () => {
  afterEach(() => jest.restoreAllMocks());

  it("caps list pagination at query level and returns metadata plus allowlisted rows", async () => {
    const listAndCount = jest.fn().mockResolvedValue([[
      {
        id: "tbnotif_list",
        payment_id: "pay_list",
        status: "REJECTED",
        order_id: "ps_list",
        amount_kopecks: 2500,
        currency_code: "RUB",
        success: false,
        error_code: "99",
        message: "Declined",
        lifecycle_state: "manual_review",
        attempt_count: 5,
        last_error_at: new Date("2026-09-01T00:00:00Z"),
        manual_review_at: new Date("2026-09-02T00:00:00Z"),
        canonical_payload_hash: "secret-hash",
        lease_token: "secret-lease",
      },
    ], 135]);
    const listAndCountAttempts = jest.fn().mockResolvedValue([[
      {
        id: "tbatt_missing", payment_session_id: "ps_missing", provider_id: "pp_tbank_tbank",
        order_id: "ps_missing", expected_amount_kopecks: 2500, currency_code: "rub",
        poll_state: "manual_review", poll_count: 5, poll_bank_status: "CONFIRMED",
        poll_payment_id: "pay_missing", poll_confirmed_at: new Date("2026-09-02T00:00:00Z"),
        poll_error: "Order linkage unavailable", terminal_key: "secret-terminal",
        poll_lease_token: "secret-lease",
      },
    ], 2]);
    const request = {
      query: { offset: "7", limit: "1000" },
      scope: scopeHarness({
        listAndCountTbankNotifications: listAndCount,
        listAndCountTbankPaymentAttempts: listAndCountAttempts,
      }),
    };
    const response = responseHarness();

    await Reflect.apply(listManualReviews, null, [request, response]);

    expect(listAndCount).toHaveBeenCalledWith(
      { lifecycle_state: "manual_review" },
      expect.objectContaining({ skip: 7, take: 100 }),
    );
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
      attempt_count: 2,
      attempts: [expect.objectContaining({
        id: "tbatt_missing", poll_bank_status: "CONFIRMED",
        poll_confirmed_at: new Date("2026-09-02T00:00:00Z"),
      })],
      count: 135,
      offset: 7,
      limit: 100,
      notifications: [expect.not.objectContaining({ canonical_payload_hash: expect.anything(), lease_token: expect.anything() })],
    }));
    expect(listAndCountAttempts).toHaveBeenCalledWith(
      { poll_state: "manual_review" },
      expect.objectContaining({ skip: 7, take: 100 }),
    );
    const attemptDto = response.json.mock.calls[0][0].attempts[0];
    expect(attemptDto).not.toHaveProperty("terminal_key");
    expect(attemptDto).not.toHaveProperty("poll_lease_token");
  });

  it("shows polled CONFIRMED evidence for manual review without exposing bank credentials or session data", async () => {
    jest.spyOn(PaymentReconcilerService.prototype, "inspectAttemptManualReview").mockResolvedValue({
      attempt: {
        id: "tbatt_pending", poll_state: "manual_review", poll_bank_status: "CONFIRMED",
        poll_confirmed_at: new Date("2026-09-02T00:00:00Z"), poll_error: "No durable order",
        terminal_key: "secret-terminal", poll_lease_token: "secret-lease",
      },
      conflicts: [{ id: "tbconf_attempt", conflict_kind: "operator_poll_retry", conflicting_payload_hash: "secret" }],
      paymentSession: {
        id: "payses_1", status: "captured", provider_id: "pp_tbank_tbank",
        amount: 100, currency_code: "rub", payment_collection_id: "pc_1",
        data: { token: "secret" }, created_at: new Date(), updated_at: new Date(),
      },
    });
    const response = responseHarness();
    await Reflect.apply(inspectManualReview, null, [
      { params: { id: "tbatt_pending" }, scope: scopeHarness() }, response,
    ]);
    const details = response.json.mock.calls[0][0].details;
    expect(details.paymentAttempt).toMatchObject({
      poll_bank_status: "CONFIRMED",
      poll_confirmed_at: new Date("2026-09-02T00:00:00Z"),
      poll_error: "No durable order",
    });
    expect(details.paymentAttempt).not.toHaveProperty("terminal_key");
    expect(details.paymentAttempt).not.toHaveProperty("poll_lease_token");
    expect(details.conflicts[0]).not.toHaveProperty("conflicting_payload_hash");
    expect(details.paymentSession).not.toHaveProperty("data");
  });

  it("returns allowlisted detail DTOs without payment-session data or raw hashes", async () => {
    jest.spyOn(PaymentReconcilerService.prototype, "inspectManualReview").mockResolvedValue({
      notification: { id: "tbnotif_detail", payment_id: "pay_detail", lifecycle_state: "manual_review", canonical_payload_hash: "secret" },
      paymentAttempt: { id: "tbatt_detail", order_id: "ps_detail", terminal_key: "secret-terminal" },
      conflicts: [{ id: "tbconf_detail", conflict_kind: "identity_mismatch", conflicting_payload_hash: "secret" }],
      paymentSession: { id: "ps_detail", status: "pending", data: { token: "secret" } } as any,
    });
    const response = responseHarness();

    await Reflect.apply(inspectManualReview, null, [{ params: { id: "tbnotif_detail" }, scope: scopeHarness() }, response]);

    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
      details: expect.objectContaining({
        notification: expect.not.objectContaining({ canonical_payload_hash: expect.anything() }),
        paymentAttempt: expect.not.objectContaining({ terminal_key: expect.anything() }),
        conflicts: [expect.not.objectContaining({ conflicting_payload_hash: expect.anything() })],
        paymentSession: expect.not.objectContaining({ data: expect.anything() }),
      }),
    }));
  });

  it.each([
    [new ManualReviewNotFoundError("missing"), 404],
    [new ManualReviewStateError("pending"), 409],
  ])("maps typed detail error %# to HTTP status", async (error, status) => {
    jest.spyOn(PaymentReconcilerService.prototype, "inspectManualReview").mockRejectedValue(error);
    const response = responseHarness();

    await Reflect.apply(inspectManualReview, null, [{ params: { id: "tbnotif_detail" }, scope: scopeHarness() }, response]);

    expect(response.status).toHaveBeenCalledWith(status);
  });

  it("maps a zero-row retry state conflict to HTTP 409", async () => {
    jest.spyOn(PaymentReconcilerService.prototype, "retryManualReview").mockRejectedValue(new ManualReviewStateError("pending"));
    const response = responseHarness();
    const request = {
      params: { id: "tbnotif_detail" },
      validatedBody: { reason: "Retry after correction" },
      auth_context: { actor_id: "user_admin" },
      scope: scopeHarness(),
    };

    await Reflect.apply(retryManualReview, null, [request, response]);

    expect(response.status).toHaveBeenCalledWith(409);
  });

  it("maps a missing notification retry to HTTP 404", async () => {
    jest.spyOn(PaymentReconcilerService.prototype, "retryManualReview").mockRejectedValue(new ManualReviewNotFoundError("missing"));
    const response = responseHarness();
    const request = {
      params: { id: "missing" },
      validatedBody: { reason: "Retry missing" },
      auth_context: { actor_id: "user_admin" },
      scope: scopeHarness(),
    };

    await Reflect.apply(retryManualReview, null, [request, response]);

    expect(response.status).toHaveBeenCalledWith(404);
  });

  it("maps resolve operations to HTTP 404 for missing and 409 for conflict", async () => {
    jest.spyOn(PaymentReconcilerService.prototype, "resolveManualReview")
      .mockRejectedValueOnce(new ManualReviewNotFoundError("missing"))
      .mockRejectedValueOnce(new ManualReviewStateError("processed"));

    const notFoundResponse = responseHarness();
    await Reflect.apply(resolveManualReview, null, [{
      params: { id: "missing" },
      validatedBody: { reason: "Resolve missing" },
      auth_context: { actor_id: "user_admin" },
      scope: scopeHarness(),
    }, notFoundResponse]);
    expect(notFoundResponse.status).toHaveBeenCalledWith(404);

    const conflictResponse = responseHarness();
    await Reflect.apply(resolveManualReview, null, [{
      params: { id: "processed" },
      validatedBody: { reason: "Resolve conflict" },
      auth_context: { actor_id: "user_admin" },
      scope: scopeHarness(),
    }, conflictResponse]);
    expect(conflictResponse.status).toHaveBeenCalledWith(409);
  });

  it("returns HTTP 400 when query parameters fail schema validation", async () => {
    const response = responseHarness();
    const request = {
      query: { offset: "-5", limit: "25" },
      scope: scopeHarness(),
    };

    await Reflect.apply(listManualReviews, null, [request, response]);

    expect(response.status).toHaveBeenCalledWith(400);
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
      message: "Invalid query parameters",
    }));
  });

  it("enforces schema bounds on offset and limit", () => {
    expect(ManualReviewListQuerySchema.safeParse({ offset: "-1" }).success).toBe(false);
    expect(ManualReviewListQuerySchema.safeParse({ offset: "10001" }).success).toBe(false);
    expect(ManualReviewListQuerySchema.safeParse({ limit: "0" }).success).toBe(false);
    expect(ManualReviewListQuerySchema.safeParse({ offset: "500", limit: "50" }).success).toBe(true);
  });
});
