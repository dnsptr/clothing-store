import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { TBANK_NOTIFICATION_MODULE } from "../../../../modules/tbank-notifications";

export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const notificationService = req.scope.resolve<any>(TBANK_NOTIFICATION_MODULE);

  let notifications: unknown[] = [];
  try {
    if (notificationService.listTbankNotifications) {
      notifications = await notificationService.listTbankNotifications({
        lifecycle_state: "manual_review",
      });
    }
  } catch (err) {
    req.scope.resolve("logger").error(
      `Failed to list manual review notifications: ${err instanceof Error ? err.message : String(err)}`,
    );
    res.status(500).json({ message: "Failed to list manual review notifications" });
    return;
  }

  let conflicts: unknown[] = [];
  try {
    if (notificationService.listTbankNotificationConflicts) {
      conflicts = await notificationService.listTbankNotificationConflicts({
        lifecycle_state: "manual_review",
      });
    }
  } catch {
    conflicts = [];
  }

  res.json({
    notifications,
    conflicts,
  });
}
