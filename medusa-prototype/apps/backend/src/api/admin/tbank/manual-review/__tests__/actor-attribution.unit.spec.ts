import { POST as retry } from "../[id]/retry/route";
import { POST as resolve } from "../[id]/resolve/route";
import { ManualReviewActionSchema } from "../validators";

type RouteHarness = {
  readonly request: Record<string, unknown>;
  readonly response: { readonly status: jest.Mock; readonly json: jest.Mock };
  readonly retryManualReview: jest.Mock;
  readonly resolveManualReview: jest.Mock;
};

function createRouteHarness(body: Record<string, unknown>): RouteHarness {
  const retryManualReview = jest.fn().mockResolvedValue([]);
  const resolveManualReview = jest.fn().mockResolvedValue([]);
  const logger = { error: jest.fn(), info: jest.fn(), warn: jest.fn() };
  const scope = {
    resolve: jest.fn((name: string) => {
      if (name === "logger") return logger;
      if (name === "tbankNotification") {
        return { retryManualReview, resolveManualReview };
      }
      if (name === "payment") return {};
      return undefined;
    }),
  };
  const response = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  };
  return {
    request: {
      params: { id: "tbnotif_actor" },
      body,
      validatedBody: body,
      auth_context: { actor_id: "user_authenticated" },
      scope,
    },
    response,
    retryManualReview,
    resolveManualReview,
  };
}

describe("manual review actor attribution", () => {
  it("rejects body-supplied operator identity at the request boundary", () => {
    const result = ManualReviewActionSchema.safeParse({
      operatorId: "user_spoofed",
      reason: "Retry after outage",
    });

    expect(result.success).toBe(false);
  });

  it("ignores spoofed retry operatorId and persists the authenticated actor", async () => {
    const harness = createRouteHarness({ operatorId: "user_spoofed", reason: "Retry after outage" });

    await Reflect.apply(retry, null, [harness.request, harness.response]);

    expect(harness.retryManualReview).toHaveBeenCalledWith(
      expect.objectContaining({ operatorId: "user_authenticated", reason: "Retry after outage" }),
    );
  });

  it("ignores spoofed resolve operatorId and persists the authenticated actor", async () => {
    const harness = createRouteHarness({ operatorId: "user_spoofed", reason: "Verified duplicate" });

    await Reflect.apply(resolve, null, [harness.request, harness.response]);

    expect(harness.resolveManualReview).toHaveBeenCalledWith(
      expect.objectContaining({ operatorId: "user_authenticated", reason: "Verified duplicate" }),
    );
  });

  it("fails closed when authenticated actor context is absent", async () => {
    const harness = createRouteHarness({ reason: "Verified duplicate" });
    delete harness.request.auth_context;

    await Reflect.apply(resolve, null, [harness.request, harness.response]);

    expect(harness.response.status).toHaveBeenCalledWith(401);
    expect(harness.resolveManualReview).not.toHaveBeenCalled();
  });
});
