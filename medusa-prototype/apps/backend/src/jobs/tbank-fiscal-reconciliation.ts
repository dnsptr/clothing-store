import type { MedusaContainer } from "@medusajs/types";
import { recoverTbankFiscalOperations } from "../modules/tbank/services/refund-operations";

export default async function tbankFiscalReconciliation(container: MedusaContainer) {
  await recoverTbankFiscalOperations(container);
}
export const config = { name: "tbank-fiscal-reconciliation", schedule: "* * * * *" };
