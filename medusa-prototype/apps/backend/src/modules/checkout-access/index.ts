import { Module } from "@medusajs/framework/utils";
import CheckoutAccessModuleService from "./service";

export const CHECKOUT_ACCESS_MODULE = "checkoutAccess";

export default Module(CHECKOUT_ACCESS_MODULE, {
  service: CheckoutAccessModuleService,
});
