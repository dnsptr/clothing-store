import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { createCartWorkflow, type CreateCartWorkflowInput } from "@medusajs/medusa/core-flows";
import { refetchCart } from "@medusajs/medusa/api/store/carts/helpers";
import type { StoreCreateCartType } from "@medusajs/medusa/api/store/carts/validators";
import { CHECKOUT_ACCESS_MODULE } from "../../../modules/checkout-access";
import type CheckoutAccessModuleService from "../../../modules/checkout-access/service";

export async function POST(req: AuthenticatedMedusaRequest<StoreCreateCartType>, res: MedusaResponse): Promise<void> {
  const { result } = await createCartWorkflow(req.scope).run({
    input: { ...req.validatedBody, customer_id: req.auth_context?.actor_id } as CreateCartWorkflowInput,
  });
  const access = req.scope.resolve<CheckoutAccessModuleService>(CHECKOUT_ACCESS_MODULE);
  const token = await access.issueCartToken(result.id);
  const cart = await refetchCart(result.id, req.scope, req.queryConfig.fields);
  res.setHeader("Cache-Control", "no-store");
  res.status(200).json({ cart, cart_access_token: token });
}
