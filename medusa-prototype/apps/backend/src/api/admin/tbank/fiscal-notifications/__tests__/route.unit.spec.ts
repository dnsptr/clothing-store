import { GET } from "../route";

function response() {
  const res = { statusCode: 200, payload: null as unknown, status: jest.fn(), json: jest.fn() };
  res.status.mockImplementation((code: number) => { res.statusCode = code; return res; });
  res.json.mockImplementation((value: unknown) => { res.payload = value; return res; });
  return res;
}

const row = {
  id: "fiscal_1", terminal_key: "terminal", payment_id: "payment", order_id: "session",
  status: "RECEIPT_FAILED", receipt_type: "sell", success: false, amount_kopecks: 100,
  error_code: "205", error_message: "OFD rejected receipt", fn_number: "10",
  fiscal_document_number: "20", review_reason: "fiscal_error", review_state: "manual_review",
  created_at: "2026-10-06T00:00:00Z", fingerprint: "private hash", Token: "bank secret",
  Receipt: { Email: "buyer@example.com" }, password: "secret",
};

it("paginates manual-review fiscal errors and returns only allowlisted safe fields", async () => {
  const store = { listAndCountTbankFiscalNotifications: jest.fn().mockResolvedValue([[row], 3]) };
  const req = {
    query: { offset: "2", limit: "1" }, scope: { resolve: (key: string) => key === "tbankNotification" ? store : { error: jest.fn() } },
  };
  const res = response();
  await GET(req as never, res as never);
  expect(res.payload).toEqual({
    notifications: [expect.objectContaining({ id: "fiscal_1", error_code: "205", review_state: "manual_review" })],
    count: 3, offset: 2, limit: 1,
  });
  const json = JSON.stringify(res.payload);
  expect(json).not.toContain("private hash");
  expect(json).not.toContain("bank secret");
  expect(json).not.toContain("buyer@example.com");
  expect(json).not.toContain("password");
});

it("rejects invalid pagination before touching the journal", async () => {
  const store = { listAndCountTbankFiscalNotifications: jest.fn() };
  const req = { query: { offset: "-1", limit: "2" }, scope: { resolve: () => store } };
  const res = response();
  await GET(req as never, res as never);
  expect(res.statusCode).toBe(400);
  expect(store.listAndCountTbankFiscalNotifications).not.toHaveBeenCalled();
});
