import { randomUUID } from "crypto";
import { MedusaError, Modules, MathBN } from "@medusajs/framework/utils";
import type { BigNumberInput, ILockingModule, MedusaContainer, RefundPaymentInput, RefundPaymentOutput } from "@medusajs/types";
import type RefundLedger from "../../tbank-notifications/service";
import { blocksNextOperation, canonicalSelections, closedOperation, digest, remainingSelections, type OperationRow } from "../lib/refund-ledger";
import { TBANK_NOTIFICATION_MODULE } from "../../tbank-notifications";
import type FiscalStore from "../../tbank-notifications/service";
import type { FiscalReceiptRow } from "../../tbank-notifications/fiscal";
import { parseTbankEnvironment } from "../config";
import { TBankApiError, TBankClient } from "../lib/client";
import { rublesToKopecks, kopecksToRubles } from "../lib/money";
import { ReceiptSnapshotCodec } from "../lib/receipt-snapshot";
import { buildClosingReceipt, buildRefundReceipt } from "../lib/refund-receipt";
import type { TBankReceipt } from "../lib/receipt";
import type { ReceiptQuery } from "../lib/receipt-source";
import { TBANK_PAYMENT_PROVIDER_ID } from "../provider-id";
import type { TBankOptions, TBankSessionData } from "../service";
import type { ClosingReceiptRequest, RefundOperationSummary, RefundPreview, RefundRequest, RefundResult } from "../refund-contracts";
import { validateBankState } from "./reconciliation-trust";
import { tbankRefundWorkflow } from "../../../workflows/tbank-refund";

type NativePayment = {
  id: string; amount: BigNumberInput; currency_code: string; provider_id: string; payment_collection_id: string;
  payment_session?: { id: string }; captured_at?: string | Date | null; data?: Record<string, unknown>;
};
type OrderLink = { order?: { id: string; summary?: { pending_difference?: BigNumberInput; raw_pending_difference?: BigNumberInput } } };
export type RefundRuntime = { query: ReceiptQuery; ledger: RefundLedger; bank: TBankClient; options: TBankOptions };
type PaymentContext = { payment: NativePayment; data: TBankSessionData; original: TBankReceipt; snapshotHash: string; order?: OrderLink["order"] };

function runtime(container: MedusaContainer): RefundRuntime {
  const config = parseTbankEnvironment(process.env);
  if (!config.enabled) throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "Т-Банк отключён");
  return {
    query: container.resolve<ReceiptQuery>("query"), ledger: container.resolve<RefundLedger>(TBANK_NOTIFICATION_MODULE), options: config.options,
    bank: new TBankClient(config.options),
  };
}
function fail(message: string): never { throw new MedusaError(MedusaError.Types.INVALID_DATA, message); }
function validKey(key: string): void {
  if (typeof key !== "string" || !key.trim() || key.length > 255) fail("Нужен постоянный ключ операции длиной до 255 символов");
}
async function paymentContext(rt: RefundRuntime, filters: { id: string } | { payment_session_id: string }): Promise<PaymentContext> {
  const result = await rt.query.graph<NativePayment>({
    entity: "payment", fields: ["id", "amount", "currency_code", "provider_id", "payment_collection_id", "payment_session.id", "captured_at", "data"], filters,
  });
  const payment = result.data[0];
  if (!payment) throw new MedusaError(MedusaError.Types.NOT_FOUND, "Платёж Medusa не найден");
  if (payment.provider_id !== TBANK_PAYMENT_PROVIDER_ID || payment.currency_code.toLowerCase() !== "rub") fail("Платёж не относится к рублёвому терминалу Т-Банка");
  if (!payment.captured_at) throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "Возвращать можно только подтверждённый платёж");
  const data = (payment.data ?? {}) as TBankSessionData;
  if (!data.paymentId || !data.orderId || data.orderId !== payment.payment_session?.id || !data.cartSnapshot || !data.receiptSnapshotEnvelope) fail("Нет проверяемого снимка оплаченного заказа");
  const snapshot = new ReceiptSnapshotCodec(rt.options.receiptSnapshotSecret).open(data.receiptSnapshotEnvelope);
  const original = snapshot.payload.receipt;
  const total = original.Items.reduce((sum, item) => sum + item.Amount, 0);
  if (snapshot.payload.sessionId !== data.orderId || snapshot.payload.cartId !== data.cartSnapshot.cartId ||
      data.cartSnapshot.orderId !== data.orderId || data.cartSnapshot.currencyCode !== "rub" ||
      total !== data.cartSnapshot.amountKopecks || total !== rublesToKopecks(payment.amount)) fail("Сохранённый чек не совпадает с платёжной сессией и суммой Medusa");
  const links = await rt.query.graph<OrderLink>({
    entity: "order_payment_collection", fields: ["order.id", "order.summary"], filters: { payment_collection_id: payment.payment_collection_id },
  });
  return { payment, data, original, snapshotHash: digest(original), order: links.data[0]?.order };
}
function summary(row: OperationRow): RefundOperationSummary {
  if (row.kind === "prepayment") throw new Error("Initial fiscal proof is not a refund operation");
  return {
    kind: row.kind, id: row.id, idempotency_key: row.idempotency_key, amount_kopecks: row.amount_kopecks,
    state: row.state, fiscal_state: row.fiscal_state, native_refund_id: row.native_refund_id,
    error_code: row.error_code, created_at: new Date(row.created_at).toISOString(),
  };
}
function result(row: OperationRow): RefundResult { return { payment_id: row.payment_id, operation: summary(row) }; }
function expectedBalance(rows: readonly OperationRow[], original: number): number {
  return original - rows.filter((row) => row.kind === "refund" && row.state === "succeeded").reduce((sum, row) => sum + row.amount_kopecks, 0);
}
async function prepare(rt: RefundRuntime, context: PaymentContext, request: RefundRequest | ClosingReceiptRequest, kind: "refund" | "closing"): Promise<OperationRow> {
  validKey(request.idempotency_key);
  const items = canonicalSelections(request.items);
  const mode = kind === "closing" ? "full_payment" : (request as RefundRequest).receipt_mode;
  const receipt = kind === "closing" ? buildClosingReceipt(context.original, items) : buildRefundReceipt(context.original, items, mode);
  const amount = receipt.Items.reduce((sum, item) => sum + item.Amount, 0);
  const pending = context.order?.summary?.raw_pending_difference ?? context.order?.summary?.pending_difference ?? 0;
  const owed = MathBN.lt(pending, 0) ? rublesToKopecks(MathBN.mult(pending, -1)) : 0;
  return rt.ledger.prepare({
    kind, payment_id: context.payment.id, payment_session_id: context.data.orderId!, bank_payment_id: context.data.paymentId!,
    terminal_key: rt.options.terminalKey, idempotency_key: request.idempotency_key, snapshot_hash: context.snapshotHash,
    original: context.original, selections: items, receipt_mode: mode, operator_id: request.operator_id,
    note: "note" in request ? request.note : undefined,
    refund_reason_id: "refund_reason_id" in request ? request.refund_reason_id : undefined,
    credit_amount_kopecks: context.order ? Math.max(0, amount - owed) : 0,
  });
}

export async function getTbankRefundPreview(container: MedusaContainer, paymentId: string): Promise<RefundPreview> {
  const rt = runtime(container);
  const context = await paymentContext(rt, { id: paymentId });
  const rows = await rt.ledger.operations(paymentId);
  const available = remainingSelections(context.original, rows);
  const closing = closedOperation(rows);
  let unavailable: string | undefined;
  if (!context.order) unavailable = "Платёж ещё не связан с заказом; доступен возврат денег, но не передача товара";
  else if (rt.options.apiBaseUrl !== "https://securepay.tinkoff.ru/v2") unavailable = "Кассовый API закрывающего чека не доступен на тестовом API банка";
  else if (closing) unavailable = "Закрывающий чек уже подтверждён кассой";
  else if (rows.some(blocksNextOperation)) unavailable = "Есть незавершённая денежная или кассовая операция";
  else if (!available.length) unavailable = "Все позиции уже возвращены";
  else if (rows.some((row) => row.kind === "refund" && row.state === "succeeded")) unavailable = "После частичного возврата аванса банк не принимает закрывающий чек; требуется прямое подключение ККТ";
  else if (!rows.some((row) => row.kind === "prepayment" && row.fiscal_state === "succeeded")) unavailable = "Ожидается подтверждённый кассовый чек предоплаты";
  return {
    payment_id: paymentId, order_id: context.order?.id ?? null, currency_code: "rub",
    paid_amount_kopecks: context.data.cartSnapshot!.amountKopecks, receipt_mode: closing ? "full_payment" : "prepayment",
    closing_available: unavailable === undefined, ...(unavailable ? { closing_unavailable_reason: unavailable } : {}),
    refundable_amount_kopecks: available.reduce((sum, item) => sum + context.original.Items[item.line_index].Price * item.quantity, 0),
    lines: context.original.Items.map((item, line_index) => {
      const remaining = available.find((line) => line.line_index === line_index);
      return { line_index, name: item.Name, price_kopecks: item.Price, quantity: item.Quantity,
        available_quantity: remaining?.quantity ?? 0, payment_object: item.PaymentObject,
        ...(remaining?.mark_codes ? { available_mark_codes: remaining.mark_codes } : {}) };
    }),
    operations: rows.filter((row) => row.kind !== "prepayment").map(summary),
  };
}

async function projectRefund(container: MedusaContainer, rt: RefundRuntime, context: PaymentContext, operation: OperationRow): Promise<OperationRow> {
  const locking = container.resolve<ILockingModule>(Modules.LOCKING);
  return locking.execute(`tbank-refund-project:${operation.payment_id}`, async (signal) => {
    signal?.throwIfAborted();
    operation = await rt.ledger.operation(operation.id);
    if (operation.state === "rejected" || operation.native_refund_id) return operation;
    const execution = await tbankRefundWorkflow(container).run({
      input: {
        payment_id: operation.payment_id, order_id: context.order?.id, amount: kopecksToRubles(operation.amount_kopecks),
        credit_amount: kopecksToRubles(operation.credit_amount_kopecks), idempotency_key: operation.idempotency_key,
        operation_id: operation.id, created_by: operation.operator_id, ...(operation.note ? { note: operation.note } : {}),
        ...(operation.refund_reason_id ? { refund_reason_id: operation.refund_reason_id } : {}),
      },
      context: { transactionId: `${operation.id}_${randomUUID()}`, idempotencyKey: operation.id }, throwOnError: false,
    });
    if (execution.errors.length) {
      const row = await rt.ledger.operation(operation.id);
      if (row.state === "rejected" || row.state === "indeterminate" || row.state === "submitting") return row;
      const error = execution.errors[0].error;
      if (error instanceof MedusaError) throw error;
      throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, "Возврат сохранён; учёт Medusa ещё не завершён, повторите с прежним ключом");
    }
    signal?.throwIfAborted();
    await rt.ledger.linkNativeRefund(operation.id, execution.result.id);
    return rt.ledger.operation(operation.id);
  }, { timeout: 30, expire: 60 });
}

export async function requestTbankRefund(container: MedusaContainer, request: RefundRequest): Promise<RefundResult> {
  const rt = runtime(container);
  const context = await paymentContext(rt, { id: request.payment_id });
  const operation = await prepare(rt, context, request, "refund");
  return result(await projectRefund(container, rt, context, operation));
}

function safeCode(error: unknown): string {
  return error instanceof TBankApiError && /^[A-Za-z0-9_-]{1,64}$/.test(error.errorCode) ? error.errorCode : "UNKNOWN";
}
function definiteRejection(error: unknown): boolean {
  return error instanceof TBankApiError && ((/^\d+$/.test(error.errorCode) && error.errorCode !== "0") || ["INVALID_REQUEST", "API_BASE_URL"].includes(error.errorCode));
}

/** Called by Medusa's native refund step. Selectors never come from an untrusted cart. */
export async function executeTbankProviderRefund(rt: RefundRuntime, input: RefundPaymentInput): Promise<RefundPaymentOutput> {
  const data = (input.data ?? {}) as TBankSessionData;
  const key = input.context?.idempotency_key;
  if (!data.orderId || !data.paymentId || typeof key !== "string") fail("Нет банковского платежа либо постоянного ключа возврата");
  validKey(key);
  const context = await paymentContext(rt, { payment_session_id: data.orderId });
  if (context.data.paymentId !== data.paymentId || context.data.receiptSnapshotEnvelope !== data.receiptSnapshotEnvelope) fail("Провайдер получил данные другой банковской попытки");
  const amount = rublesToKopecks(input.amount);
  const rows = await rt.ledger.operations(context.payment.id);
  let operation = rows.find((row) => row.idempotency_key === key);
  if (!operation) {
    const available = remainingSelections(context.original, rows);
    if (available.reduce((sum, line) => sum + context.original.Items[line.line_index].Price * line.quantity, 0) !== amount) {
      throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "Для частичного возврата выберите точные товары в разделе «Чеки и возвраты Т-Банка»");
    }
    operation = await prepare(rt, context, {
      payment_id: context.payment.id, idempotency_key: key, items: available,
      receipt_mode: closedOperation(rows) ? "full_payment" : "prepayment", operator_id: "native-payment-workflow",
    }, "refund");
  }
  if (operation.kind !== "refund" || operation.amount_kopecks !== amount || operation.snapshot_hash !== context.snapshotHash ||
      operation.bank_payment_id !== data.paymentId || operation.terminal_key !== rt.options.terminalKey) fail("Сумма, терминал или снимок возврата не совпадает с сохранённой операцией");
  if (operation.state === "rejected") throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "Банк отклонил эту операцию; исправленный возврат требует нового ключа");
  if (operation.state !== "succeeded") {
    const bankState = await rt.bank.getState(data.paymentId);
    const trust = validateBankState(bankState, { payment_id: data.paymentId, order_id: data.orderId, amount_kopecks: operation.balance_before_kopecks }, rt.options.terminalKey, true);
    const after = operation.balance_before_kopecks - amount;
    // Looking up an existing idempotent result is safe even after a lost response
    // when the bank's remaining balance is too small to execute this amount anew.
    const safeLookup = operation.state !== "prepared" && after < amount &&
      validateBankState(bankState, { payment_id: data.paymentId, order_id: data.orderId, amount_kopecks: after }, rt.options.terminalKey, true).valid &&
      bankState.Status === (after === 0 ? "REFUNDED" : "PARTIAL_REFUNDED");
    if (!(trust.valid && ["CONFIRMED", "PARTIAL_REFUNDED"].includes(bankState.Status ?? "")) && !safeLookup) {
      if (operation.state !== "prepared") {
        await rt.ledger.finishSubmission({ id: operation.id, state: "indeterminate", error_code: "BANK_BALANCE_RECONCILIATION" });
      }
      throw new MedusaError(MedusaError.Types.CONFLICT, "Состояние банка изменилось; новый Cancel не отправлен, требуется подписанное подтверждение прежнего возврата");
    }
    if (!await rt.ledger.claimSubmission(operation.id)) throw new MedusaError(MedusaError.Types.CONFLICT, "Возврат уже обрабатывается; не создавайте новый ключ");
    try {
      // The priority bank OpenAPI forbids Receipt for a full-original cancellation.
      // A partial-original refund uses exact rows, even when returning the final balance.
      const automaticOriginal = amount === operation.original_amount_kopecks;
      const response = await rt.bank.cancel({
        paymentId: data.paymentId, externalRequestId: operation.external_request_id, merchRefundId: operation.id,
        amountKopecks: amount, ...(automaticOriginal ? {} : { receipt: buildRefundReceipt(context.original, operation.selections, operation.receipt_mode) }),
      });
      const after = operation.balance_before_kopecks - amount;
      if (response.OrderId !== data.orderId || response.OriginalAmount !== operation.balance_before_kopecks || response.NewAmount !== after ||
          response.Status !== (after === 0 ? "REFUNDED" : "PARTIAL_REFUNDED")) {
        throw new TBankApiError("Cancel", "BAD_RESPONSE", "Refund balance/status correlation failed");
      }
      operation = await rt.ledger.finishSubmission({ id: operation.id, state: "succeeded" });
    } catch (error) {
      await rt.ledger.finishSubmission({ id: operation.id, state: definiteRejection(error) ? "rejected" : "indeterminate", error_code: safeCode(error) });
      throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, definiteRejection(error) ? "Банк отклонил возврат; ошибка сохранена" : "Результат возврата пока неизвестен; сохранён прежний ключ, новый возврат не создаётся");
    }
  }
  return { data: { ...data, status: operation.balance_before_kopecks === amount ? "REFUNDED" : "PARTIAL_REFUNDED" } };
}

export async function requestTbankClosingReceipt(container: MedusaContainer, request: ClosingReceiptRequest): Promise<RefundResult> {
  const rt = runtime(container);
  const context = await paymentContext(rt, { id: request.payment_id });
  if (!context.order) throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "Нет заказа для передачи товара");
  if (rt.options.apiBaseUrl !== "https://securepay.tinkoff.ru/v2") throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "Для закрывающего чека требуется документированный боевой кассовый API");
  if ((await rt.ledger.operations(request.payment_id)).some((row) => row.kind === "refund" && row.state === "succeeded")) {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "SendClosingReceipt разрешён банком только при CONFIRMED; после возврата аванса нужен прямой API ККТ");
  }
  let operation = await prepare(rt, context, request, "closing");
  if (operation.state !== "prepared") return result(operation);
  const state = await rt.bank.getState(context.data.paymentId!);
  const trust = validateBankState(state, { payment_id: context.data.paymentId!, order_id: context.data.orderId!, amount_kopecks: operation.balance_before_kopecks }, rt.options.terminalKey, true);
  if (!trust.valid || state.Status !== "CONFIRMED") throw new MedusaError(MedusaError.Types.CONFLICT, "Закрывающий чек требует GetState=CONFIRMED и точной суммы платежа");
  if (!await rt.ledger.claimSubmission(operation.id)) return result(await rt.ledger.operation(operation.id));
  try {
    const response = await rt.bank.sendClosingReceipt({ paymentId: context.data.paymentId!, receipt: buildClosingReceipt(context.original, operation.selections) });
    if (response.ErrorCode !== "0") throw new TBankApiError("SendClosingReceipt", "BAD_RESPONSE", "Uncorrelated closing acknowledgement");
    operation = await rt.ledger.finishSubmission({ id: operation.id, state: "succeeded" });
  } catch (error) {
    operation = await rt.ledger.finishSubmission({ id: operation.id, state: definiteRejection(error) ? "rejected" : "indeterminate", error_code: safeCode(error) });
  }
  return result(operation);
}

/** The inbox is already authenticated and durable. No financial mutation follows from a fiscal receipt. */
export async function applyTbankFiscalReceipt(container: MedusaContainer, receipt: FiscalReceiptRow): Promise<boolean> {
  if (receipt.lifecycle_state === "manual_review") return false;
  const rt = runtime(container);
  if (receipt.terminal_key !== rt.options.terminalKey) return false;
  let context: PaymentContext;
  try { context = await paymentContext(rt, { payment_session_id: receipt.order_id }); }
  catch (error) { if (error instanceof MedusaError && [MedusaError.Types.NOT_FOUND, MedusaError.Types.NOT_ALLOWED].includes(error.type)) return false; throw error; }
  if (context.data.paymentId !== receipt.payment_id) return false;
  const rows = await rt.ledger.operations(context.payment.id);
  const linked = rows.find((row) => row.fiscal_receipt_id === receipt.id);
  if (linked) {
    return rt.ledger.applyFiscal({ id: linked.id, receipt_id: receipt.id, canonical_hash: receipt.canonical_payload_hash,
      receipt_type: receipt.receipt_type, success: receipt.success, error_code: receipt.error_code });
  }
  const initial = rows.find((row) => row.kind === "prepayment" && row.fiscal_state === "succeeded");
  let operation: OperationRow | undefined;
  if (initial) {
    const candidates = rows.filter((row) => row.kind !== "prepayment" && row.state !== "rejected" && row.fiscal_state !== "succeeded" &&
      row.amount_kopecks === receipt.amount_kopecks && (row.kind === "closing"
        ? receipt.receipt_type === initial.fiscal_receipt_type && row.state !== "prepared"
        : receipt.receipt_type !== initial.fiscal_receipt_type && row.state === "succeeded"));
    if (candidates.length === 1) operation = candidates[0];
  } else if (receipt.success && receipt.amount_kopecks === context.data.cartSnapshot!.amountKopecks) {
    const state = await rt.bank.getState(receipt.payment_id);
    const balance = expectedBalance(rows, context.data.cartSnapshot!.amountKopecks);
    const trust = validateBankState(state, { payment_id: receipt.payment_id, order_id: receipt.order_id, amount_kopecks: balance }, rt.options.terminalKey, true);
    const delayedIncomeAfterFullRefund = state.Status === "REFUNDED" && balance === 0 &&
      receipt.receipt_type.toLowerCase() === "income";
    if (trust.valid && (["CONFIRMED", "PARTIAL_REFUNDED"].includes(state.Status ?? "") || delayedIncomeAfterFullRefund)) {
      const proof = await rt.ledger.recordPrepayment({
        id: `tbref_${digest([context.payment.id, "prepayment"]).slice(0, 26)}`, kind: "prepayment", payment_id: context.payment.id,
        payment_session_id: receipt.order_id, bank_payment_id: receipt.payment_id, terminal_key: receipt.terminal_key,
        idempotency_key: "initial-fiscal-proof", request_hash: receipt.canonical_payload_hash, snapshot_hash: context.snapshotHash,
        external_request_id: "not-applicable", amount_kopecks: receipt.amount_kopecks, original_amount_kopecks: receipt.amount_kopecks,
        balance_before_kopecks: receipt.amount_kopecks, credit_amount_kopecks: 0, selections: [], receipt_mode: "prepayment", state: "succeeded", fiscal_state: "succeeded",
        fiscal_receipt_id: receipt.id, fiscal_receipt_type: receipt.receipt_type, native_refund_id: null,
        error_code: null, operator_id: "authenticated-bank-notification", note: null, submitted_at: null,
        refund_reason_id: null,
      });
      if (proof) operation = proof;
    }
  }
  if (!operation) return false;
  if (operation.kind === "prepayment") return true;
  return rt.ledger.applyFiscal({ id: operation.id, receipt_id: receipt.id, canonical_hash: receipt.canonical_payload_hash,
    receipt_type: receipt.receipt_type, success: receipt.success, error_code: receipt.error_code });
}

export async function recoverTbankFiscalOperations(container: MedusaContainer): Promise<void> {
  const config = parseTbankEnvironment(process.env);
  if (!config.enabled) return;
  const rt = runtime(container);
  const logger = container.resolve("logger");
  const store = container.resolve<FiscalStore>(TBANK_NOTIFICATION_MODULE);
  const receipts: FiscalReceiptRow[] = await store.listTbankFiscalReceipts({ lifecycle_state: "awaiting_correlation" }, { take: 20, order: { updated_at: "ASC" } });
  for (const receipt of receipts) {
    try { await applyTbankFiscalReceipt(container, receipt); }
    catch { logger.error(`tbank fiscal reconciliation failed for inbox ${receipt.id}`); }
    finally { await store.deferFiscalReceipt(receipt.id); }
  }
  for (const operation of await rt.ledger.recoveryBatch(10)) {
    try {
      const context = await paymentContext(rt, { id: operation.payment_id });
      await projectRefund(container, rt, context, operation);
    } catch { logger.error(`tbank refund reconciliation failed for operation ${operation.id}`); }
    finally { await rt.ledger.deferRefundOperation(operation.id); }
  }
}

/** Keep the standard Medusa full-refund action on the same durable fiscal path. */
export async function requestTbankAmountRefund(
  container: MedusaContainer,
  request: Omit<RefundRequest, "items" | "receipt_mode"> & { amount?: BigNumberInput },
): Promise<RefundResult> {
  const rt = runtime(container);
  const context = await paymentContext(rt, { id: request.payment_id });
  const rows = await rt.ledger.operations(request.payment_id);
  const existing = rows.find((row) => row.idempotency_key === request.idempotency_key);
  const items = existing?.selections ?? remainingSelections(context.original, rows);
  const amount = items.reduce((sum, item) => sum + context.original.Items[item.line_index].Price * item.quantity, 0);
  if (request.amount !== undefined && rublesToKopecks(request.amount) !== amount) {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "Для частичного возврата выберите точные товары в разделе «Чеки и возвраты Т-Банка»");
  }
  const operation = await prepare(rt, context, {
    ...request, items, receipt_mode: existing?.receipt_mode ?? (closedOperation(rows) ? "full_payment" : "prepayment"),
  }, "refund");
  return result(await projectRefund(container, rt, context, operation));
}
