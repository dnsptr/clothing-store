import { addOrderTransactionStep, createOrderChangeActionsWorkflow, emitEventStep, refundPaymentStep } from "@medusajs/core-flows";
import { createStep, createWorkflow, StepResponse, transform, WorkflowResponse } from "@medusajs/framework/workflows-sdk";
import { ChangeActionType, MathBN, MedusaError, Modules, OrderChangeType, PaymentEvents } from "@medusajs/framework/utils";
import type { BigNumberInput, IOrderModuleService, OrderChangeDTO, PaymentDTO } from "@medusajs/framework/types";
import type { ReceiptQuery } from "../modules/tbank/lib/receipt-source";

export type TbankRefundWorkflowInput = {
  payment_id: string;
  order_id?: string;
  amount: BigNumberInput;
  credit_amount: BigNumberInput;
  idempotency_key: string;
  operation_id: string;
  created_by: string;
  note?: string;
  refund_reason_id?: string;
};

const resolveTbankRefund = createStep("resolve-tbank-refund", (input: { payment: PaymentDTO; idempotency_key: string }) => {
  const refund = input.payment.refunds?.find((item) => item.idempotency_key === input.idempotency_key);
  if (!refund) throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, "Medusa не сохранила возврат с ожидаемым ключом");
  return new StepResponse({ id: refund.id, amount: refund.amount });
});

const ensureCreditLine = createStep("tbank-ensure-refund-credit", async (input: TbankRefundWorkflowInput, { container }) => {
  if (!input.order_id || MathBN.eq(input.credit_amount, 0)) return new StepResponse(null);
  const query = container.resolve<ReceiptQuery>("query");
  const creditQuery = {
    entity: "order", fields: ["id", "credit_lines.reference", "credit_lines.reference_id", "credit_lines.amount"],
    filters: { id: input.order_id },
  };
  type CreditedOrder = { credit_lines?: Array<{ reference?: string; reference_id?: string; amount: BigNumberInput }> };
  const before = await query.graph<CreditedOrder>(creditQuery);
  const recorded = before.data[0]?.credit_lines?.filter((line) => line.reference === "tbank_refund" && line.reference_id === input.operation_id) ?? [];
  if (recorded.length) {
    if (recorded.length !== 1 || !MathBN.eq(recorded[0].amount, input.credit_amount)) {
      throw new MedusaError(MedusaError.Types.CONFLICT, "Учётная сумма возврата не совпадает с сохранённой операцией");
    }
    return new StepResponse(null);
  }
  const orders = container.resolve<IOrderModuleService>(Modules.ORDER);
  const changes = await query.graph<OrderChangeDTO>({
    entity: "order_change", fields: ["id", "version", "metadata", "actions.reference", "actions.reference_id"],
    filters: { order_id: input.order_id, status: "pending" },
  });
  const pending = changes.data.filter((change) => change.metadata?.tbank_refund_operation === input.operation_id);
  if (pending.length > 1) throw new MedusaError(MedusaError.Types.CONFLICT, "Найдено несколько изменений для одного возврата");
  // Persist the operation marker WITH change creation: even an empty change is
  // recoverable after process death, before an action or workflow checkpoint.
  const change = pending[0] ?? await orders.createOrderChange({
    order_id: input.order_id, change_type: OrderChangeType.CREDIT_LINE, created_by: input.created_by,
    metadata: { tbank_refund_operation: input.operation_id },
  });
  if (!change.actions?.some((action) => action.reference === "tbank_refund" && action.reference_id === input.operation_id)) {
    await createOrderChangeActionsWorkflow(container).run({
      input: [{
        order_change_id: change.id, order_id: input.order_id, version: change.version,
        action: ChangeActionType.CREDIT_LINE_ADD, reference: "tbank_refund", reference_id: input.operation_id,
        amount: input.credit_amount,
      }],
    });
  }
  await orders.confirmOrderChange([{ id: change.id, confirmed_by: input.created_by }]);
  const after = await query.graph<CreditedOrder>(creditQuery);
  const credits = after.data[0]?.credit_lines?.filter((line) => line.reference === "tbank_refund" && line.reference_id === input.operation_id) ?? [];
  if (credits.length !== 1 || !MathBN.eq(credits[0].amount, input.credit_amount)) {
    throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, "Medusa ещё не подтвердила учётную строку возврата");
  }
  return new StepResponse(null);
});

/**
 * Native money/accounting primitives, not a second payment engine.
 * Medusa 2.22.4 refundPaymentWorkflow validates amount before replay detection;
 * its full-refund retry can fail after funds already moved. The payment module's
 * native refund step performs the same guard UNDER its row lock AFTER replay.
 */
export const tbankRefundWorkflow = createWorkflow(
  { name: "tbank-fiscal-refund", store: true },
  function (input: TbankRefundWorkflowInput) {
    const payment = refundPaymentStep(input);
    const target = resolveTbankRefund({ payment, idempotency_key: input.idempotency_key });
    const transactions = transform({ target, input, payment }, ({ target, input, payment }) => input.order_id ? [{
      order_id: input.order_id, amount: MathBN.mult(input.amount, -1), currency_code: payment.currency_code,
      reference: "refund", reference_id: target.id,
    }] : []);
    const recordedTransactions = addOrderTransactionStep(transactions);
    const creditInput = transform({ input, recordedTransactions }, ({ input }) => input);
    const credit = ensureCreditLine(creditInput);
    const eventData = transform({ input, credit }, ({ input }) => ({ id: input.payment_id }));
    emitEventStep({ eventName: PaymentEvents.REFUNDED, data: eventData });
    return new WorkflowResponse(target);
  },
);
