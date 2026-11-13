import { MedusaError } from "@medusajs/framework/utils";
import type { IInventoryService, ILockingModule } from "@medusajs/types";
import type { ReceiptQuery } from "../tbank/lib/receipt-source";
import { CHECKOUT_HOLD_MS, type CheckoutHoldRow, type HoldAllocation } from "./contracts";

export interface HoldLedger {
  findPaymentHold(sessionId: string): Promise<CheckoutHoldRow | undefined>;
  listOpenCartHolds(cartId: string, now: Date): Promise<readonly CheckoutHoldRow[]>;
  heldQuantities(inventoryIds: readonly string[], now: Date): Promise<readonly HoldAllocation[]>;
  insertPaymentHold(input: CheckoutHoldRow): Promise<void>;
}

interface InventoryCart {
  id: string;
  sales_channel_id: string;
  items: Array<{
    quantity: number;
    variant?: {
      manage_inventory: boolean;
      allow_backorder: boolean;
      inventory_items: Array<{
        inventory_item_id: string;
        required_quantity: number;
        inventory: { location_levels: Array<{
          location_id: string;
          stock_locations: Array<{ sales_channels: Array<{ id: string }> }>;
        }> };
      }>;
    };
  }>;
}

const CART_INVENTORY_FIELDS = [
  "id", "sales_channel_id", "items.quantity", "items.variant.manage_inventory", "items.variant.allow_backorder",
  "items.variant.inventory_items.inventory_item_id", "items.variant.inventory_items.required_quantity",
  "items.variant.inventory_items.inventory.location_levels.location_id",
  "items.variant.inventory_items.inventory.location_levels.stock_locations.sales_channels.id",
];

async function requestsForCart(query: ReceiptQuery, cartId: string) {
  const { data } = await query.graph<InventoryCart>({ entity: "cart", fields: CART_INVENTORY_FIELDS, filters: { id: cartId } });
  const cart = data[0];
  if (data.length !== 1 || cart?.id !== cartId || !cart.items?.length || !cart.sales_channel_id) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "checkout: корзина для онлайн-резерва не найдена");
  }
  const requests = new Map<string, { quantity: number; locations: string[] }>();
  for (const item of cart.items) {
    if (!Number.isSafeInteger(item.quantity) || item.quantity <= 0 || !item.variant) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "checkout: некорректная позиция онлайн-резерва");
    }
    if (!item.variant.manage_inventory || item.variant.allow_backorder) continue;
    if (!item.variant.inventory_items?.length) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "checkout: товар не связан с учётом остатков");
    }
    for (const inventoryItem of item.variant.inventory_items) {
      const quantity = Number(inventoryItem.required_quantity) * item.quantity;
      if (!Number.isSafeInteger(quantity) || quantity <= 0) {
        throw new MedusaError(MedusaError.Types.INVALID_DATA, "checkout: некорректное количество складского товара");
      }
      const locations = inventoryItem.inventory.location_levels.filter((level) =>
        level.stock_locations?.some((location) => location.sales_channels?.some((channel) => channel.id === cart.sales_channel_id)),
      ).map((level) => level.location_id);
      const existing = requests.get(inventoryItem.inventory_item_id);
      requests.set(inventoryItem.inventory_item_id, {
        quantity: quantity + (existing?.quantity ?? 0),
        locations: existing ? existing.locations.filter((id) => locations.includes(id)) : locations,
      });
    }
  }
  return requests;
}

export async function acquireOnlineHold(
  dependencies: { query: ReceiptQuery; inventory: Pick<IInventoryService, "listInventoryLevels">; locking: ILockingModule; ledger: HoldLedger },
  sessionId: string,
  cartId: string,
) {
  const { query, inventory, locking, ledger } = dependencies;
  const initial = await requestsForCart(query, cartId);
  const inventoryIds = Array.from(initial.keys()).sort();
  // Same plain inventory-item keys as Medusa reserveInventoryStep. The cart
  // key additionally serializes two different payment sessions for one cart.
  return locking.execute([`checkout-hold:cart:${cartId}`, ...inventoryIds], async () => {
    const requests = await requestsForCart(query, cartId);
    if (requests.size !== initial.size || Array.from(requests.keys()).some((id) => !initial.has(id))) {
      throw new MedusaError(MedusaError.Types.CONFLICT, "checkout: состав корзины изменился при резервировании");
    }
    const now = new Date();
    const existing = await ledger.findPaymentHold(sessionId);
    if (existing) {
      if (existing.cart_id !== cartId || existing.state !== "active" || new Date(existing.expires_at).getTime() <= now.getTime()) {
        throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "checkout: срок онлайн-резерва истёк или попытка уже завершена");
      }
      const actual = new Map(existing.allocations.map((allocation) => [allocation.inventory_item_id, allocation]));
      if (actual.size !== requests.size || Array.from(requests).some(([id, request]) => {
        const allocation = actual.get(id);
        return !allocation || allocation.quantity !== request.quantity || !request.locations.includes(allocation.location_id);
      })) {
        throw new MedusaError(MedusaError.Types.CONFLICT, "checkout: состав корзины изменился после онлайн-резерва");
      }
      return existing; // Preserve the original deadline, never renew on retry.
    }
    if ((await ledger.listOpenCartHolds(cartId, now)).length) {
      throw new MedusaError(MedusaError.Types.CONFLICT, "checkout: у корзины уже есть активная банковская попытка");
    }
    const levels = inventoryIds.length ? await inventory.listInventoryLevels({ inventory_item_id: inventoryIds }, { take: null }) : [];
    const held = inventoryIds.length ? await ledger.heldQuantities(inventoryIds, now) : [];
    const allocations: HoldAllocation[] = [];
    for (const [inventoryId, request] of requests) {
      let unreserved = 0;
      let onlineHeld = 0;
      let level: (typeof levels)[number] | undefined;
      for (const allocation of held) {
        if (allocation.inventory_item_id === inventoryId) onlineHeld += allocation.quantity;
      }
      for (const candidate of levels) {
        if (candidate.inventory_item_id !== inventoryId || !request.locations.includes(candidate.location_id)) continue;
        const free = Number(candidate.stocked_quantity) - Number(candidate.reserved_quantity);
        unreserved += free;
        if (!level) {
          const other = held.find((allocation) => allocation.inventory_item_id === inventoryId && allocation.location_id === candidate.location_id)?.quantity ?? 0;
          if (free - other >= request.quantity) level = candidate;
        }
      }
      // Native completion may choose another eligible shop. Count every
      // outstanding online allocation globally as well as at its original shop.
      if (!level || !Number.isFinite(unreserved) || unreserved - onlineHeld < request.quantity) {
        throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "checkout: товар уже зарезервирован или закончился", MedusaError.Codes.INSUFFICIENT_INVENTORY);
      }
      allocations.push({ inventory_item_id: inventoryId, location_id: level.location_id, quantity: request.quantity });
    }
    const expiresAt = new Date(Math.floor((now.getTime() + CHECKOUT_HOLD_MS) / 1000) * 1000);
    const row: CheckoutHoldRow = {
      id: `chold_${sessionId}`, payment_session_id: sessionId, cart_id: cartId,
      allocations, state: "active", expires_at: expiresAt,
    };
    await ledger.insertPaymentHold(row);
    return row;
  }, { timeout: 30 });
}
