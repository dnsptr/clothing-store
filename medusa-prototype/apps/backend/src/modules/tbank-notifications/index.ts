import { Module } from "@medusajs/framework/utils";

import TbankNotificationModuleService from "./service";

export const TBANK_NOTIFICATION_MODULE = "tbankNotification";

export default Module(TBANK_NOTIFICATION_MODULE, {
  service: TbankNotificationModuleService,
});
