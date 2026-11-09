import type { MedusaContainer } from "@medusajs/framework/types";
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils";
import { addShippingMethodToCartWorkflow } from "@medusajs/medusa/core-flows";
import { CART_FIELDS, type ReceiptQuery } from "../modules/tbank/lib/receipt-source";
import { rublesToKopecks } from "../modules/tbank/lib/money";
import type { BigNumberInput } from "@medusajs/framework/types";

const APPROVED_DELIVERY_CODES: Readonly<Record<string, true>> = {
  "pickup-store": true,
  "cdek-pvz": true,
  "cdek-courier": true,
  "yandex-pvz": true,
  "own-courier-mkad": true,
};

type PaymentDeliveryCart = {
  id: string;
  total: BigNumberInput;
  shipping_total: BigNumberInput;
  shipping_methods: Array<{
    shipping_option_id: string;
    data: Record<string, unknown> | null;
    shipping_option?: { type?: { code?: string } };
  }>;
};

/** Reprice the saved selection with current packaging, destination and promotion rules. */
export async function revalidateCheckoutDeliveryForPayment(
  container: MedusaContainer,
  cartId: string,
  expectedTotal: number,
): Promise<void> {
  const query = container.resolve<ReceiptQuery>(ContainerRegistrationKeys.QUERY);
  const { data } = await query.graph<PaymentDeliveryCart>({
    entity: "cart",
    fields: [...CART_FIELDS, "shipping_methods.shipping_option_id",
      "shipping_methods.data", "shipping_methods.shipping_option.type.code"],
    filters: { id: cartId },
  });
  const cart = data[0];
  const method = cart?.shipping_methods?.[0];
  const code = method?.shipping_option?.type?.code;
  if (data.length !== 1 || cart?.id !== cartId || cart.shipping_methods?.length !== 1 ||
      !method?.shipping_option_id || !code || APPROVED_DELIVERY_CODES[code] !== true) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "Выберите доступный способ доставки перед оплатой");
  }
  if (!Number.isFinite(expectedTotal) || expectedTotal <= 0) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "Подтвердите итоговую сумму заказа");
  }
  await addShippingMethodToCartWorkflow(container).run({
    input: { cart_id: cartId, options: [{ id: method.shipping_option_id, data: method.data ?? {} }] },
  });
  const refreshed = await query.graph<PaymentDeliveryCart>({
    entity: "cart", fields: CART_FIELDS, filters: { id: cartId },
  });
  const current = refreshed.data[0];
  let totalKopecks = NaN;
  let shippingKopecks = NaN;
  try {
    totalKopecks = rublesToKopecks(current?.total as BigNumberInput);
    shippingKopecks = rublesToKopecks(current?.shipping_total as BigNumberInput);
  } catch { /* Invalid computed totals must fail closed before bank Init. */ }
  if (refreshed.data.length !== 1 || !current ||
      !Number.isSafeInteger(totalKopecks) || !Number.isSafeInteger(shippingKopecks) ||
      totalKopecks !== rublesToKopecks(expectedTotal) ||
      (code === "pickup-store" && shippingKopecks !== 0)) {
    throw new MedusaError(MedusaError.Types.CONFLICT, "Стоимость заказа или доставки изменилась. Проверьте итог и подтвердите заказ ещё раз");
  }
}
