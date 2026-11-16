jest.mock("../../../../../../modules/tbank/services/refund-operations", () => ({
  getTbankRefundPreview: jest.fn(),
  requestTbankRefund: jest.fn(),
  requestTbankClosingReceipt: jest.fn(),
}));

import { getTbankRefundPreview, requestTbankClosingReceipt, requestTbankRefund } from "../../../../../../modules/tbank/services/refund-operations";
import { GET, POST } from "../route";
import { POST as close } from "../../tbank-closing-receipt/route";

const refundMock = requestTbankRefund as jest.Mock;
const closingMock = requestTbankClosingReceipt as jest.Mock;
const previewMock = getTbankRefundPreview as jest.Mock;

function harness() {
  return {
    req: {
      params: { id: "pay_native" }, scope: {},
      auth_context: { actor_id: "user_authenticated" },
      validatedBody: {
        payment_id: "pay_spoofed", operator_id: "user_spoofed",
        idempotency_key: "attempt_exact", receipt_mode: "prepayment",
        items: [{ line_index: 2, quantity: 1 }], note: "Requested by buyer",
      },
    },
    res: { setHeader: jest.fn(), status: jest.fn().mockReturnThis(), json: jest.fn() },
  };
}
const result = (state = "submitting", fiscal_state = "pending") => ({
  payment_id: "pay_native",
  operation: { id: "op_1", kind: "refund", state, fiscal_state, idempotency_key: "attempt_exact" },
});

beforeEach(() => {
  jest.resetAllMocks();
  refundMock.mockResolvedValue(result());
  closingMock.mockResolvedValue(result());
});

describe("authenticated T-Bank fiscal routes", () => {
  it("binds the real actor and path payment without forwarding spoofed identities", async () => {
    const { req, res } = harness();
    await Reflect.apply(POST, null, [req, res]);
    expect(refundMock).toHaveBeenCalledWith(req.scope, {
      payment_id: "pay_native", operator_id: "user_authenticated",
      idempotency_key: "attempt_exact", items: req.validatedBody.items,
      receipt_mode: "prepayment", note: "Requested by buyer",
    });
    expect(res.status).toHaveBeenCalledWith(202);
    expect(res.setHeader).toHaveBeenCalledWith("Cache-Control", "no-store");
  });

  it("binds closing identity and never forwards refund mode or note", async () => {
    const { req, res } = harness();
    await Reflect.apply(close, null, [req, res]);
    expect(closingMock).toHaveBeenCalledWith(req.scope, {
      payment_id: "pay_native", operator_id: "user_authenticated",
      idempotency_key: "attempt_exact", items: req.validatedBody.items,
    });
  });

  it.each([GET, POST, close])("fails closed without an authenticated actor", async (handler) => {
    const { req, res } = harness();
    await Reflect.apply(handler, null, [{ ...req, auth_context: undefined }, res]);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(refundMock).not.toHaveBeenCalled();
    expect(closingMock).not.toHaveBeenCalled();
    expect(previewMock).not.toHaveBeenCalled();
  });

  it("protects exact preview rows and codes against shared caches", async () => {
    const { req, res } = harness();
    const preview = { payment_id: "pay_native", lines: [{ available_mark_codes: ["actual"] }] };
    previewMock.mockResolvedValue(preview);
    await Reflect.apply(GET, null, [req, res]);
    expect(previewMock).toHaveBeenCalledWith(req.scope, "pay_native");
    expect(res.setHeader).toHaveBeenCalledWith("Cache-Control", "no-store");
    expect(res.json).toHaveBeenCalledWith({ refund: preview });
  });

  it.each([
    ["succeeded", "pending", 202], ["succeeded", "failed", 202],
    ["indeterminate", "pending", 202], ["succeeded", "succeeded", 200], ["rejected", "pending", 200],
  ])("does not mistake %s/%s for a completed fiscal refund", async (state, fiscal, status) => {
    const { req, res } = harness();
    const response = result(String(state), String(fiscal));
    refundMock.mockResolvedValue(response);
    await Reflect.apply(POST, null, [req, res]);
    expect(res.status).toHaveBeenCalledWith(status);
    expect(res.json).toHaveBeenCalledWith({ refund: response });
  });

  it("forwards an identical idempotency key and selection on network retry", async () => {
    const { req, res } = harness();
    await Reflect.apply(POST, null, [req, res]);
    await Reflect.apply(POST, null, [req, res]);
    expect(refundMock.mock.calls[0]).toEqual(refundMock.mock.calls[1]);
  });

  it("lets framework map coordinator errors rather than disguising them as success", async () => {
    const { req, res } = harness();
    const error = new Error("Conflict");
    refundMock.mockRejectedValue(error);
    await expect(Reflect.apply(POST, null, [req, res])).rejects.toBe(error);
    expect(res.json).not.toHaveBeenCalled();
  });
});
