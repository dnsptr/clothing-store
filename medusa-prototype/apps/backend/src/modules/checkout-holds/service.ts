import { container as applicationContainer } from "@medusajs/framework";
import type { Context, IInventoryService, ILockingModule } from "@medusajs/framework/types";
import type { EntityManager } from "@medusajs/framework/mikro-orm/knex";
import { InjectManager, MedusaContext, MedusaService, Modules } from "@medusajs/framework/utils";
import type { ReceiptQuery } from "../tbank/lib/receipt-source";
import { acquireOnlineHold } from "./allocation";
import type { CheckoutHoldRow, HoldAllocation } from "./contracts";
import CheckoutHold from "./models/checkout-hold";

function manager(context: Context<EntityManager>) {
  if (!context.manager) throw new Error("checkout: online allocation ledger database is unavailable");
  return context.manager;
}

class CheckoutHoldModuleService extends MedusaService({ CheckoutHold }) {
  async acquirePaymentHold(sessionId: string, cartId: string) {
    return acquireOnlineHold({
      query: applicationContainer.resolve<ReceiptQuery>("query"),
      inventory: applicationContainer.resolve<IInventoryService>(Modules.INVENTORY),
      locking: applicationContainer.resolve<ILockingModule>(Modules.LOCKING),
      ledger: this,
    }, sessionId, cartId);
  }

  @InjectManager()
  async findPaymentHold(sessionId: string, @MedusaContext() context: Context<EntityManager> = {}) {
    const rows = await manager(context).execute<CheckoutHoldRow[]>(
      "select * from checkout_hold where payment_session_id = ? and deleted_at is null", [sessionId],
    );
    return rows[0];
  }

  @InjectManager()
  async listOpenCartHolds(cartId: string, now: Date, @MedusaContext() context: Context<EntityManager> = {}) {
    return manager(context).execute<CheckoutHoldRow[]>(
      `select * from checkout_hold where cart_id = ? and deleted_at is null
        and state in ('active', 'expired', 'settling')`, [cartId],
    );
  }

  @InjectManager()
  async heldQuantities(inventoryIds: readonly string[], now: Date, @MedusaContext() context: Context<EntityManager> = {}) {
    if (!inventoryIds.length) return [];
    const rows = await manager(context).execute<Array<{ inventory_item_id: string; location_id: string; quantity: string }>>(
      `select allocation->>'inventory_item_id' as inventory_item_id,
          allocation->>'location_id' as location_id,
          sum((allocation->>'quantity')::numeric) as quantity
        from checkout_hold cross join lateral jsonb_array_elements(allocations) as allocation
        where deleted_at is null and state in ('active', 'expired', 'settling')
          and allocation->>'inventory_item_id' in (${inventoryIds.map(() => "?").join(",")})
        group by allocation->>'inventory_item_id', allocation->>'location_id'`, [...inventoryIds],
    );
    return rows.map((row): HoldAllocation => ({ ...row, quantity: Number(row.quantity) }));
  }

  @InjectManager()
  async insertPaymentHold(row: CheckoutHoldRow, @MedusaContext() context: Context<EntityManager> = {}) {
    await manager(context).execute(
      `insert into checkout_hold (id, payment_session_id, cart_id, allocations, state, expires_at, created_at, updated_at)
       values (?, ?, ?, ?::jsonb, 'active', ?, now(), now())`,
      [row.id, row.payment_session_id, row.cart_id, JSON.stringify(row.allocations), row.expires_at],
    );
  }

  @InjectManager()
  async settlePaymentHold(sessionId: string, @MedusaContext() context: Context<EntityManager> = {}) {
    // A verified capture freezes our allocation until durable order linkage or
    // manual recovery. Expiry/cancel never deletes a paid order's allocation.
    await manager(context).execute(
      `update checkout_hold set state = 'settling', updated_at = now()
       where payment_session_id = ? and state in ('active', 'expired', 'released') and deleted_at is null`, [sessionId],
    );
  }

  async consumePaymentHold(sessionId: string) {
    const hold = await this.findPaymentHold(sessionId);
    if (!hold || hold.state === "consumed") return;
    const query = applicationContainer.resolve<ReceiptQuery>("query");
    const payments = await query.graph<{ captured_at?: Date | string | null }>({
      entity: "payment", fields: ["captured_at"], filters: { payment_session_id: sessionId },
    });
    const orderLinks = await query.graph<{ order_id?: string }>({
      entity: "order_cart", fields: ["order_id"], filters: { cart_id: hold.cart_id },
    });
    if (!payments.data.some((payment) => payment.captured_at) || !orderLinks.data[0]?.order_id) {
      throw new Error("checkout: cannot consume online allocation before durable capture and order linkage");
    }
    await this.finishCapturedHold(sessionId);
  }

  @InjectManager()
  async finishCapturedHold(sessionId: string, @MedusaContext() context: Context<EntityManager> = {}) {
    await manager(context).execute(
      "update checkout_hold set state = 'consumed', updated_at = now() where payment_session_id = ? and deleted_at is null", [sessionId],
    );
  }

  @InjectManager()
  async releasePaymentHold(sessionId: string, @MedusaContext() context: Context<EntityManager> = {}) {
    await manager(context).execute(
      `update checkout_hold set state = 'released', updated_at = now()
       where payment_session_id = ? and state in ('active', 'expired') and deleted_at is null`, [sessionId],
    );
  }

  @InjectManager()
  // Expiry closes the payment window, not the financial uncertainty window.
  // Keep counting this allocation until a trusted terminal bank result releases
  // it: a delayed CONFIRMED notification must not sell the same unit twice.
  async expirePaymentHolds(@MedusaContext() context: Context<EntityManager> = {}) {
    await manager(context).execute(
      `update checkout_hold set state = 'expired', updated_at = now()
       where state = 'active' and expires_at <= now() and deleted_at is null`,
    );
  }

  @InjectManager()
  async claimExpiredPaymentHolds(@MedusaContext() context: Context<EntityManager> = {}) {
    // Rotate uncertain attempts, rather than starving everything behind the
    // first batch when the bank cannot yet give a conclusive answer.
    return manager(context).execute<CheckoutHoldRow[]>(
      `update checkout_hold set updated_at = now() where id in (
         select id from checkout_hold where state = 'expired' and deleted_at is null
         order by updated_at, id limit 50
       ) returning *`,
    );
  }
}

export default CheckoutHoldModuleService;
