import { MedusaService } from "@medusajs/framework/utils";

import TbankNotification from "./models/tbank-notification";

class TbankNotificationModuleService extends MedusaService({
  TbankNotification,
}) {}

export default TbankNotificationModuleService;
