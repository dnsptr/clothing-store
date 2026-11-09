export const CHECKOUT_HOLD_MODULE = "checkoutHold";
export const CHECKOUT_HOLD_MS = 10 * 60 * 1000;

export type HoldAllocation = {
  readonly inventory_item_id: string;
  readonly location_id: string;
  readonly quantity: number;
};

export type CheckoutHoldRow = {
  readonly id: string;
  readonly payment_session_id: string;
  readonly cart_id: string;
  readonly allocations: readonly HoldAllocation[];
  readonly state: "active" | "settling" | "consumed" | "released" | "expired";
  readonly expires_at: Date | string;
};

export interface PaymentCheckoutHolds {
  acquirePaymentHold(sessionId: string, cartId: string): Promise<CheckoutHoldRow>;
  settlePaymentHold(sessionId: string): Promise<void>;
  consumePaymentHold(sessionId: string): Promise<void>;
  releasePaymentHold(sessionId: string): Promise<void>;
  expirePaymentHolds(): Promise<void>;
}
