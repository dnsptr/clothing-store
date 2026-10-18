const PAYMENT_RETURN_STORAGE_KEY = "clothing-store-payment-return";
const CART_ID_REGEX = /^cart_[0-9A-HJKMNP-TV-Z]{26}$/;

export type PaymentReturnContext = {
  readonly cartId: string;
  readonly cartAccessToken: string;
  readonly paymentConfirmed: boolean;
};

/** Keep the bank-bound cart in this tab, independently of a newer shopping cart. */
export function rememberPaymentReturnContext(context: PaymentReturnContext): void {
  window.sessionStorage.setItem(PAYMENT_RETURN_STORAGE_KEY, JSON.stringify(context));
}

export function getPaymentReturnContext(): PaymentReturnContext | null {
  try {
    const raw = window.sessionStorage.getItem(PAYMENT_RETURN_STORAGE_KEY);
    if (!raw) return null;
    const context: unknown = JSON.parse(raw);
    if (!context || typeof context !== "object" ||
        !("cartId" in context) || typeof context.cartId !== "string" || !CART_ID_REGEX.test(context.cartId) ||
        !("cartAccessToken" in context) || typeof context.cartAccessToken !== "string" || !/^[a-f0-9]{64}$/.test(context.cartAccessToken) ||
        !("paymentConfirmed" in context) || typeof context.paymentConfirmed !== "boolean") {
      return null;
    }
    return { cartId: context.cartId, cartAccessToken: context.cartAccessToken, paymentConfirmed: context.paymentConfirmed };
  } catch {
    return null;
  }
}
