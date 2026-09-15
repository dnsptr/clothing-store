export type PaymentReturnState =
  | { readonly kind: "verifying" }
  | { readonly kind: "order_processing" }
  | { readonly kind: "success" }
  | { readonly kind: "failed" }
  | { readonly kind: "timeout" }
  | { readonly kind: "order_delayed" }
  | { readonly kind: "unverified" };
