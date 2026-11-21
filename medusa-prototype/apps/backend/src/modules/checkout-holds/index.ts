import { Module } from "@medusajs/framework/utils";
import CheckoutHoldModuleService from "./service";
import { CHECKOUT_HOLD_MODULE } from "./contracts";

export default Module(CHECKOUT_HOLD_MODULE, { service: CheckoutHoldModuleService });
