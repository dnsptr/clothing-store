import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import type { PaymentSessionDTO } from "@medusajs/types";
import { z } from "zod";

import { TBANK_NOTIFICATION_MODULE } from "../../../../modules/tbank-notifications";
import {
  canonicalNotificationHash,
  correlateNotification,
  toAuthenticatedNotification,
} from "../../../../modules/tbank-notifications/lifecycle";
import type { TbankNotificationStore } from "../../../../modules/tbank-notifications/lifecycle";
import { parseTbankEnvironment, TBankConfigurationError } from "../../../../modules/tbank/config";
import { verifyNotificationToken } from "../../../../modules/tbank/lib/token";

const ACK_BODY = "OK";
const BODY_SCHEMA = z.record(z.string(), z.unknown());

type ConflictInput = {
  readonly canonicalNotificationId: string | null;
  readonly canonicalHash: string | null;
  readonly incomingHash: string;
  readonly terminalKey: string;
  readonly paymentId: string;
  readonly status: string;
  readonly kind: "canonical_payload_changed" | "correlation_mismatch" | "malformed_authenticated";
  readonly failures: readonly string[];
};

async function recordConflict(
  notifications: TbankNotificationStore,
  input: ConflictInput,
): Promise<void> {
  await notifications.createTbankNotificationConflicts({
    canonical_notification_id: input.canonicalNotificationId,
    terminal_key: input.terminalKey,
    payment_id: input.paymentId,
    status: input.status,
    canonical_payload_hash: input.canonicalHash,
    conflicting_payload_hash: input.incomingHash,
    conflict_kind: input.kind,
    correlation_failures: input.failures.length === 0 ? null : input.failures.join(","),
    lifecycle_state: "manual_review",
  });
}

export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const logger = req.scope.resolve("logger");
  let configuration: ReturnType<typeof parseTbankEnvironment>;
  try {
    configuration = parseTbankEnvironment(process.env);
  } catch (error) {
    if (!(error instanceof TBankConfigurationError)) throw error;
    logger.error("tbank webhook: provider configuration is invalid");
    res.status(503).send("payment provider is not configured");
    return;
  }
  if (!configuration.enabled) {
    res.status(503).send("payment provider is not configured");
    return;
  }

  const bodyResult = BODY_SCHEMA.safeParse(req.body);
  if (!bodyResult.success || !verifyNotificationToken(bodyResult.data, configuration.options.password)) {
    logger.warn("tbank webhook: invalid signature");
    res.status(401).send("invalid token");
    return;
  }

  let notification: ReturnType<typeof toAuthenticatedNotification>;
  try {
    notification = toAuthenticatedNotification(bodyResult.data);
  } catch (error) {
    const notifications = req.scope.resolve<TbankNotificationStore>(TBANK_NOTIFICATION_MODULE);
    const paymentId = bodyResult.data["PaymentId"];
    const status = bodyResult.data["Status"];
    try {
      await recordConflict(notifications, {
        canonicalNotificationId: null,
        canonicalHash: null,
        incomingHash: canonicalNotificationHash(bodyResult.data),
        terminalKey: typeof bodyResult.data["TerminalKey"] === "string" ? bodyResult.data["TerminalKey"] : configuration.options.terminalKey,
        paymentId: typeof paymentId === "string" || typeof paymentId === "number" ? String(paymentId) : "missing",
        status: typeof status === "string" ? status : "missing",
        kind: "malformed_authenticated",
        failures: ["payload"],
      });
    } catch (persistenceError) {
      logger.error(`tbank webhook: malformed audit failed: ${persistenceError instanceof Error ? persistenceError.message : String(persistenceError)}`);
      res.status(500).send("failed to record malformed notification");
      return;
    }
    logger.warn(`tbank webhook: quarantined malformed authenticated notification: ${error instanceof Error ? error.message : String(error)}`);
    res.send(ACK_BODY);
    return;
  }

  const notifications = req.scope.resolve<TbankNotificationStore>(TBANK_NOTIFICATION_MODULE);
  const incomingHash = canonicalNotificationHash(bodyResult.data);
  const key = {
    terminal_key: notification.terminalKey,
    payment_id: notification.paymentId,
    status: notification.status,
  };
  const existing = await notifications.listTbankNotifications(key);
  if (existing.length > 0) {
    const canonical = existing[0];
    if (canonical?.canonical_payload_hash !== incomingHash) {
      try {
        await recordConflict(notifications, {
          canonicalNotificationId: canonical?.id ?? null,
          canonicalHash: canonical?.canonical_payload_hash ?? null,
          incomingHash,
          terminalKey: notification.terminalKey,
          paymentId: notification.paymentId,
          status: notification.status,
          kind: "canonical_payload_changed",
          failures: [],
        });
      } catch (error) {
        logger.error(`tbank webhook: conflict audit failed: ${error instanceof Error ? error.message : String(error)}`);
        res.status(500).send("failed to record notification conflict");
        return;
      }
    }
    res.send(ACK_BODY);
    return;
  }

  const paymentService = req.scope.resolve<{ retrievePaymentSession(id: string): Promise<PaymentSessionDTO> }>("payment");
  let lifecycleState: "pending" | "awaiting_correlation" = "pending";
  let session: PaymentSessionDTO | undefined;
  try {
    session = await paymentService.retrievePaymentSession(notification.orderId);
  } catch (error) {
    logger.warn(`tbank webhook: correlation deferred: ${error instanceof Error ? error.message : String(error)}`);
    lifecycleState = "awaiting_correlation";
  }
  if (session) {
    const correlation = correlateNotification(notification, session, configuration.options.terminalKey);
    if (correlation.kind === "mismatch") {
      try {
        await recordConflict(notifications, {
          canonicalNotificationId: null,
          canonicalHash: null,
          incomingHash,
          terminalKey: notification.terminalKey,
          paymentId: notification.paymentId,
          status: notification.status,
          kind: "correlation_mismatch",
          failures: correlation.fields,
        });
      } catch (error) {
        logger.error(`tbank webhook: correlation audit failed: ${error instanceof Error ? error.message : String(error)}`);
        res.status(500).send("failed to record notification conflict");
        return;
      }
      res.send(ACK_BODY);
      return;
    }
  }

  let createdNotification: { id?: string } | undefined;
  try {
    createdNotification = (await notifications.createTbankNotifications({
      ...key,
      order_id: notification.orderId,
      amount_kopecks: notification.amountKopecks,
      currency_code: notification.currencyCode,
      success: notification.success,
      error_code: null,
      message: null,
      canonical_payload_hash: incomingHash,
      lifecycle_state: lifecycleState,
      attempt_count: 0,
    })) as { id?: string };
  } catch (error) {
    const raced = await notifications.listTbankNotifications(key);
    const canonical = raced[0];
    if (!canonical) {
      logger.error(`tbank webhook: inbox write failed: ${error instanceof Error ? error.message : String(error)}`);
      res.status(500).send("failed to record notification");
      return;
    }
    if (canonical.canonical_payload_hash !== incomingHash) {
      try {
        await recordConflict(notifications, {
          canonicalNotificationId: canonical.id,
          canonicalHash: canonical.canonical_payload_hash,
          incomingHash,
          terminalKey: notification.terminalKey,
          paymentId: notification.paymentId,
          status: notification.status,
          kind: "canonical_payload_changed",
          failures: [],
        });
      } catch (conflictError) {
        logger.error(`tbank webhook: race conflict audit failed: ${conflictError instanceof Error ? conflictError.message : String(conflictError)}`);
        res.status(500).send("failed to record notification conflict");
        return;
      }
    }
  }

  const notificationId =
    createdNotification?.id ??
    (Array.isArray(createdNotification) ? createdNotification[0]?.id : undefined);
  if (notificationId) {
    try {
      const eventBus = req.scope.resolve<{
        emit(event: { name: string; data: unknown }): Promise<void>;
      }>("event_bus");
      await eventBus.emit({
        name: "tbank.notification.received",
        data: { id: notificationId },
      });
    } catch (emitError) {
      logger.warn(
        `tbank webhook: acceleration event emission failed for ${notificationId}: ${
          emitError instanceof Error ? emitError.message : String(emitError)
        }`,
      );
    }
  }

  res.send(ACK_BODY);
}
