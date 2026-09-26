import { Module } from "@medusajs/framework/utils";

import TbankNotificationModuleService from "./service";
import { TBANK_NOTIFICATION_MODULE } from "./module-id";

export { TBANK_NOTIFICATION_MODULE } from "./module-id";

export default Module(TBANK_NOTIFICATION_MODULE, {
  service: TbankNotificationModuleService,
});
