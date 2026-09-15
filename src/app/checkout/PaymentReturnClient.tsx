"use client";

import { PaymentReturnView } from "./PaymentReturnView";
import { usePaymentReturnStatus } from "./usePaymentReturnStatus";

export default function PaymentReturnClient() {
  return <PaymentReturnView state={usePaymentReturnStatus()} />;
}
