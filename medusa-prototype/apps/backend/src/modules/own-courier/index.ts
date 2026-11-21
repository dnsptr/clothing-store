import { ModuleProvider, Modules } from "@medusajs/framework/utils";

import OwnCourierFulfillmentProviderService from "./service";

export default ModuleProvider(Modules.FULFILLMENT, {
  services: [OwnCourierFulfillmentProviderService],
});
