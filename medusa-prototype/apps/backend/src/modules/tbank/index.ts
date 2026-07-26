import { ModuleProvider, Modules } from "@medusajs/framework/utils";

import TBankPaymentProviderService from "./service";

export default ModuleProvider(Modules.PAYMENT, {
  services: [TBankPaymentProviderService],
});
