export const SYSTEM_DEFAULT_PAYMENT_PROVIDER_ID = "pp_system_default";
export const TBANK_PAYMENT_PROVIDER_ID = "pp_tbank_tbank";

type CheckoutConfiguration = {
  readonly providerId: string;
  readonly nodeEnvironment: string | undefined;
  readonly allowTestCheckout: boolean;
};

export function isCheckoutEnabledForConfiguration({
  providerId,
  nodeEnvironment,
  allowTestCheckout,
}: CheckoutConfiguration): boolean {
  if (providerId === TBANK_PAYMENT_PROVIDER_ID) {
    return true;
  }

  return (
    providerId === SYSTEM_DEFAULT_PAYMENT_PROVIDER_ID &&
    nodeEnvironment !== "production" &&
    allowTestCheckout
  );
}
