import { ModuleProvider, Modules } from "@medusajs/framework/utils";

import YandexDeliveryFulfillmentProviderService from "./service";

export default ModuleProvider(Modules.FULFILLMENT, {
  services: [YandexDeliveryFulfillmentProviderService],
});
