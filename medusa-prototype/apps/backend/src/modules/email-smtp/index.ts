import { ModuleProvider, Modules } from "@medusajs/framework/utils";

import EmailSmtpNotificationProviderService from "./service";

export default ModuleProvider(Modules.NOTIFICATION, {
  services: [EmailSmtpNotificationProviderService],
});
