import { isFullyCaptured } from "../prepaid-order";

describe("prepaid fulfillment eligibility", () => {
  it("does not mistake authorization or a partial capture for full payment", () => {
    expect(isFullyCaptured(1000, [{}])).toBe(false);
    expect(isFullyCaptured(1000, [{ captures: [{ amount: 999.99 }] }])).toBe(false);
    expect(isFullyCaptured(1000, [{ captures: [{ amount: 600 }, { amount: 400 }] }])).toBe(true);
  });

  it("subtracts refunds across all payment collections", () => {
    expect(isFullyCaptured(1000, [
      { captures: [{ amount: 700 }], refunds: [{ amount: 100 }] },
      { captures: [{ amount: 300 }] },
    ])).toBe(false);
    expect(isFullyCaptured(1000, [
      { captures: [{ amount: 700 }] }, { captures: [{ amount: 300 }] },
    ])).toBe(true);
  });

  it.each([0, -1, NaN, Infinity, "invalid"])("rejects invalid order total %s", (total) => {
    expect(isFullyCaptured(total, [{ captures: [{ amount: 1000 }] }])).toBe(false);
  });

  it("fails closed on invalid bank ledger amounts", () => {
    expect(isFullyCaptured(1000, [{ captures: [{ amount: NaN }] }])).toBe(false);
    expect(isFullyCaptured(1000, [{ captures: [{ amount: 1000 }], refunds: [{ amount: -1 }] }])).toBe(false);
  });
});
