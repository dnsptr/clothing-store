import { acquireOnlineHold } from "../allocation";
import type { CheckoutHoldRow } from "../contracts";

const OPEN_STATES: Readonly<Record<string, true>> = { active: true, expired: true, settling: true };

function fixture() {
  const rows: CheckoutHoldRow[] = [];
  let quantity = 1;
  const levels = [{
    inventory_item_id: "inventory_1", location_id: "store_1", stocked_quantity: 2, reserved_quantity: 1,
  }];
  const inventory = { listInventoryLevels: async () => levels };
  const query = { graph: async ({ filters }: { filters: { id: string } }) => ({ data: [{
    id: filters.id, sales_channel_id: "sales_1", items: [{ quantity, variant: {
      manage_inventory: true, allow_backorder: false, inventory_items: [{
        inventory_item_id: "inventory_1", required_quantity: 1,
        inventory: { location_levels: levels.map(level => ({
          location_id: level.location_id, stock_locations: [{ sales_channels: [{ id: "sales_1" }] }],
        })) },
      }],
    } }],
  }] }) };
  const ledger = {
    findPaymentHold: async (sessionId: string) => rows.find(row => row.payment_session_id === sessionId),
    listOpenCartHolds: async (cartId: string) => rows.filter(row => row.cart_id === cartId && OPEN_STATES[row.state]),
    heldQuantities: async () => rows.filter(row => OPEN_STATES[row.state]).flatMap(row => [...row.allocations]),
    insertPaymentHold: async (row: CheckoutHoldRow) => { rows.push(row); },
  };
  const locking = { execute: async (_keys: string[], work: () => Promise<unknown>) => work() };
  return {
    dependencies: { query, inventory, ledger, locking } as unknown as Parameters<typeof acquireOnlineHold>[0],
    rows, levels, setQuantity: (value: number) => { quantity = value; },
  };
}

describe("online checkout allocation", () => {
  it("counts native reservations and other online checkouts before the bank is called", async () => {
    const f = fixture();
    await acquireOnlineHold(f.dependencies, "session_1", "cart_1");
    await expect(acquireOnlineHold(f.dependencies, "session_2", "cart_2")).rejects.toHaveProperty("type", "not_allowed");
  });

  it("does not extend the payment window when the same attempt is retried", async () => {
    const f = fixture();
    const first = await acquireOnlineHold(f.dependencies, "session_1", "cart_1");
    const again = await acquireOnlineHold(f.dependencies, "session_1", "cart_1");
    expect(again.expires_at).toEqual(first.expires_at);
    f.setQuantity(2);
    await expect(acquireOnlineHold(f.dependencies, "session_1", "cart_1")).rejects.toHaveProperty("type", "conflict");
  });

  it("does not release stock merely because the clock expired while the bank result is unknown", async () => {
    const f = fixture();
    const first = await acquireOnlineHold(f.dependencies, "session_1", "cart_1");
    f.rows[0] = { ...first, state: "expired", expires_at: new Date(0) };
    await expect(acquireOnlineHold(f.dependencies, "session_2", "cart_2")).rejects.toHaveProperty("type", "not_allowed");
    f.rows[0] = { ...first, state: "released" };
    const replacement = await acquireOnlineHold(f.dependencies, "session_2", "cart_2");
    expect(replacement.allocations).toEqual([{ inventory_item_id: "inventory_1", location_id: "store_1", quantity: 1 }]);
  });
});

it("cannot oversell when native order reservation chooses a different eligible shop", async () => {
  const f = fixture();
  f.levels[0] = { inventory_item_id: "inventory_1", location_id: "store_1", stocked_quantity: 1, reserved_quantity: 0 };
  f.levels.push({ ...f.levels[0], location_id: "store_2" });
  const first = await acquireOnlineHold(f.dependencies, "session_1", "cart_1");
  await acquireOnlineHold(f.dependencies, "session_2", "cart_2");
  // Native completion can choose another eligible location than the online
  // ledger. The remaining online hold must still count against total stock.
  f.levels[1].reserved_quantity = 1;
  f.rows[0] = { ...first, state: "consumed" };
  await expect(acquireOnlineHold(f.dependencies, "session_3", "cart_3")).rejects.toHaveProperty("type", "not_allowed");
});
