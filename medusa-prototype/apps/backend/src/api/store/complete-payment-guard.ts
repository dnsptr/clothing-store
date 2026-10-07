import type { MedusaNextFunction, MedusaRequest, MedusaResponse } from "@medusajs/framework/http";

import { TBANK_NOTIFICATION_MODULE } from "../../modules/tbank-notifications/module-id";
import { TBANK_PAYMENT_PROVIDER_ID } from "../../modules/tbank/provider-id";
import {
  readPaymentStatus,
  type PaymentAttemptReader,
  type PaymentStatusQuery,
} from "../../modules/tbank/services/payment-status";

type PaymentSession = {
  readonly payment_collection_id?: unknown;
  readonly provider_id?: unknown;
};

// This only guards the public HTTP completion route. The signed bank webhook
// completes the cart through Medusa's internal workflow after capture.
export async function requireCapturedTbankPayment(
  req: MedusaRequest,
  res: MedusaResponse,
  next: MedusaNextFunction,
): Promise<void> {
  const cartId = req.params.id;
  const reject = () => res.status(400).json({ message: "Оплата заказа не подтверждена" });
  if (!cartId) {
    reject();
    return;
  }

  const query = req.scope.resolve<PaymentStatusQuery>("query");
  const links = await query.graph({
    entity: "cart_payment_collection",
    fields: ["cart_id", "payment_collection_id"],
    filters: { cart_id: cartId },
  });
  // An absent or ambiguous linkage is not evidence of a paid cart.
  if (links.data.length !== 1 || links.data[0]?.cart_id !== cartId ||
    typeof links.data[0]?.payment_collection_id !== "string") {
    reject();
    return;
  }
  const collectionId = links.data[0].payment_collection_id;
  const collectionLinks = await query.graph({
    entity: "cart_payment_collection",
    fields: ["cart_id", "payment_collection_id"],
    filters: { payment_collection_id: collectionId },
  });
  if (collectionLinks.data.length !== 1 ||
    collectionLinks.data[0]?.cart_id !== cartId ||
    collectionLinks.data[0]?.payment_collection_id !== collectionId) {
    reject();
    return;
  }
  const result = await query.graph({
    entity: "payment_session",
    fields: ["id", "payment_collection_id", "provider_id", "status"],
    filters: { payment_collection_id: collectionId },
  });
  const sessions = result.data as readonly PaymentSession[];
  if (!sessions.length || sessions.some((session) =>
    session.payment_collection_id !== collectionId ||
    typeof session.provider_id !== "string" ||
    session.provider_id === "pp_system_default"
  )) {
    reject();
    return;
  }

  if (sessions.some((session) => session.provider_id === TBANK_PAYMENT_PROVIDER_ID)) {
    const status = await readPaymentStatus({
      query,
      attempts: req.scope.resolve<PaymentAttemptReader>(TBANK_NOTIFICATION_MODULE),
    }, cartId);
    // The webhook alone may create the first order. HTTP completion is
    // idempotent only after its durable order link already exists.
    if (status.kind !== "found" || status.value.payment !== "confirmed" ||
      status.value.order !== "ready") {
      reject();
      return;
    }
  }

  next();
}
