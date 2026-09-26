import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { z } from "zod";

import { TBANK_NOTIFICATION_MODULE } from "../../../../modules/tbank-notifications/module-id";
import {
  readPaymentStatus,
  type PaymentAttemptReader,
  type PaymentStatusQuery,
} from "../../../../modules/tbank/services/payment-status";

const CartCapabilitySchema = z.string().regex(/^cart_[0-9A-HJKMNP-TV-Z]{26}$/);
const CACHE_CONTROL = "no-store, no-cache, must-revalidate, proxy-revalidate";

export async function GET(request: MedusaRequest, response: MedusaResponse): Promise<void> {
  response.setHeader("Cache-Control", CACHE_CONTROL);
  response.setHeader("X-Content-Type-Options", "nosniff");
  const capability = CartCapabilitySchema.safeParse(request.params.cartId);
  if (!capability.success) {
    response.status(404).end();
    return;
  }

  const result = await readPaymentStatus(
    {
      query: request.scope.resolve<PaymentStatusQuery>("query"),
      attempts: request.scope.resolve<PaymentAttemptReader>(TBANK_NOTIFICATION_MODULE),
    },
    capability.data,
  );
  switch (result.kind) {
    case "found":
      response.json(result.value);
      return;
    case "not_found":
      response.status(404).end();
      return;
  }
}
