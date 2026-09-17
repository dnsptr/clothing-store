import { ModuleProvider, Modules } from "@medusajs/framework/utils";

import CdekFulfillmentProviderService from "./service";

export default ModuleProvider(Modules.FULFILLMENT, {
  services: [CdekFulfillmentProviderService],
});
