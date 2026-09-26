import {
  listShippingOptionsForCartWorkflow,
  listShippingOptionsForCartWithPricingWorkflow,
} from "@medusajs/medusa/core-flows";
import { StepResponse } from "@medusajs/framework/workflows-sdk";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import type { MedusaContainer } from "@medusajs/types";
import { parseOwnCourierEnvironment } from "../../modules/own-courier/config";
import { ownCourierEligibility } from "../../modules/own-courier/eligibility";
import { OWN_COURIER_RULE } from "../../modules/own-courier/provider-id";

export async function shippingContext(
  { cart }: { readonly cart: { readonly id: string } },
  { container }: { readonly container: MedusaContainer },
) {
  const config = parseOwnCourierEnvironment(process.env);
  if (!config.enabled) return new StepResponse({ [OWN_COURIER_RULE]: "false" });

  let eligible = false;
  try {
    const query = container.resolve(ContainerRegistrationKeys.QUERY);
    const { data: carts } = await query.graph({
      entity: "cart", filters: { id: cart.id }, fields: ["shipping_address.*"],
    });
    eligible = (await ownCourierEligibility(carts[0]?.shipping_address, config.options)).eligible;
  } catch {
    eligible = false;
  }
  return new StepResponse({ [OWN_COURIER_RULE]: eligible ? "true" : "false" });
}

listShippingOptionsForCartWorkflow.hooks.setShippingOptionsContext(shippingContext);
listShippingOptionsForCartWithPricingWorkflow.hooks.setShippingOptionsContext(shippingContext);
