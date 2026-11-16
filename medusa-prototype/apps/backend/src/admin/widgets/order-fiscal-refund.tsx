import { useEffect, useRef, useState } from "react";
import { defineWidgetConfig } from "@medusajs/admin-sdk";
import { useQueryClient } from "@tanstack/react-query";
import type { AdminOrder, DetailWidgetProps } from "@medusajs/framework/types";
import { Button, Container, Heading, Input, Label, Textarea } from "@medusajs/ui";
import { sdk } from "../lib/sdk";
import type { RefundOperationSummary, RefundPreview, RefundResult, RefundSelection } from "../../modules/tbank/refund-contracts";
import { clearFiscalAttempt, isDefinitiveRequestRejection, isFiscalOperationSettled, readFiscalAttempt, rejectFiscalAttempt, retainFiscalAttempt, type FiscalAttempt } from "../lib/order-fiscal-refund-state";

const money = (kopecks: number) => new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB" }).format(kopecks / 100);
const stateLabels: Record<RefundOperationSummary["state"], string> = {
  prepared: "Подготовлена", submitting: "Отправляется", succeeded: "Принята банком", rejected: "Отклонена", indeterminate: "Результат банка неизвестен",
};
const fiscalLabels: Record<RefundOperationSummary["fiscal_state"], string> = {
  pending: "Ожидается результат фискализации", succeeded: "Фискализация подтверждена", failed: "Ошибка фискализации — нужна проверка",
};
const fieldClass = "bg-ui-bg-field border-ui-border-base rounded border p-2 text-sm";

const OrderFiscalRefund = ({ data: order }: DetailWidgetProps<AdminOrder>) => {
  const queryClient = useQueryClient();
  const [paymentIds, setPaymentIds] = useState<string[]>([]);
  const [paymentId, setPaymentId] = useState("");
  const [preview, setPreview] = useState<RefundPreview>();
  const [quantities, setQuantities] = useState<Record<number, number>>({});
  const [selectedCodes, setSelectedCodes] = useState<Record<number, string[]>>({});
  const [scannedCodes, setScannedCodes] = useState<Record<number, string>>({});
  const [note, setNote] = useState("");
  const [attempt, setAttempt] = useState<FiscalAttempt | null>(null);
  const [lastResult, setLastResult] = useState<RefundOperationSummary>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const inFlight = useRef(false);

  useEffect(() => {
    let active = true;
    setLoading(true); setPaymentIds([]); setPaymentId(""); setPreview(undefined); setError("");
    sdk.admin.order.retrieve(order.id, {
      fields: "id,payment_collections.id,payment_collections.payments.id,payment_collections.payments.provider_id,payment_collections.payments.captured_at",
    }).then(({ order: nativeOrder }) => {
      if (!active) return;
      const ids = [...new Set((nativeOrder.payment_collections ?? []).flatMap((collection) => collection.payments ?? [])
        .filter((payment) => payment.provider_id === "pp_tbank_tbank" && payment.captured_at).map((payment) => payment.id))];
      setPaymentIds(ids); setPaymentId(ids[0] ?? "");
    }).catch((e: unknown) => { if (active) setError(e instanceof Error ? e.message : "Не удалось получить платежи заказа"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [order.id]);

  useEffect(() => {
    if (!paymentId) return;
    let active = true;
    setLoading(true); setPreview(undefined); setQuantities({}); setSelectedCodes({}); setScannedCodes({}); setNote("");
    try { setAttempt(readFiscalAttempt(window.sessionStorage, paymentId)); }
    catch (e) { setError(e instanceof Error ? e.message : "Не удалось прочитать сохранённую попытку"); setLoading(false); return; }
    sdk.client.fetch<{ refund: RefundPreview }>(`/admin/payments/${encodeURIComponent(paymentId)}/tbank-refunds`).then(({ refund }) => {
      if (!active) return;
      if (refund.order_id !== order.id || refund.payment_id !== paymentId) throw new Error("Платёж не принадлежит открытому заказу");
      setPreview(refund);
    }).catch((e: unknown) => { if (active) setError(e instanceof Error ? e.message : "Не удалось получить фискальные позиции"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [paymentId, order.id, reload]);

  const lines = preview?.lines ?? [];
  const remainingLines = lines.filter((line) => line.available_quantity > 0);
  const selected = lines.filter((line) => (quantities[line.line_index] ?? 0) > 0);
  const amount = selected.reduce((sum, line) => sum + line.price_kopecks * quantities[line.line_index], 0);
  const blocked = Boolean(preview?.operations.some((operation) => !isFiscalOperationSettled(operation)));
  const frozen = busy || loading || Boolean(attempt) || blocked;
  const attemptOperation = attempt ? preview?.operations.find((operation) => operation.idempotency_key === attempt.body.idempotency_key) ??
    (lastResult?.idempotency_key === attempt.body.idempotency_key ? lastResult : undefined) : undefined;
  const canClear = Boolean(attempt && (attemptOperation ? isFiscalOperationSettled(attemptOperation) : attempt.definitively_rejected));

  function refundItems(): RefundSelection[] {
    if (!preview || !selected.length || amount <= 0) throw new Error("Выберите позиции с положительной суммой возврата");
    return selected.map((line) => {
      const quantity = quantities[line.line_index];
      if (!Number.isSafeInteger(quantity) || quantity <= 0 || quantity > line.available_quantity) throw new Error("Количество должно быть целым и не превышать доступный остаток");
      if (preview.receipt_mode === "full_payment" && line.payment_object === "commodity" && amount !== preview.refundable_amount_kopecks) {
        const codes = selectedCodes[line.line_index] ?? [];
        if (codes.length !== quantity || codes.some((code) => !line.available_mark_codes?.includes(code))) {
          throw new Error("Для каждой возвращаемой единицы выберите её сохранённый код маркировки");
        }
        return { line_index: line.line_index, quantity, mark_codes: codes };
      }
      return { line_index: line.line_index, quantity };
    });
  }

  function closingItems(): RefundSelection[] {
    if (!preview?.closing_available || !remainingLines.length) throw new Error("Закрывающий чек недоступен");
    const usedCodes = new Set<string>();
    return remainingLines.map((line) => {
      if (line.payment_object === "service") return { line_index: line.line_index, quantity: line.available_quantity };
      const codes = (scannedCodes[line.line_index] ?? "").split(/\r?\n/).filter((code) => code.length > 0);
      if (codes.length !== line.available_quantity || codes.some((code) => {
        if (usedCodes.has(code)) return true;
        usedCodes.add(code);
        return false;
      })) throw new Error("Отсканируйте уникальный фактический DataMatrix для каждой оставшейся единицы товара");
      return { line_index: line.line_index, quantity: line.available_quantity, mark_codes: codes };
    });
  }

  async function submit(kind: "refund" | "closing", retry = false) {
    if (inFlight.current || !preview || preview.payment_id !== paymentId || preview.order_id !== order.id) return;
    inFlight.current = true; setBusy(true); setError("");
    let saved: FiscalAttempt | null = null;
    try {
      if (retry) {
        saved = readFiscalAttempt(window.sessionStorage, paymentId);
        if (!saved) throw new Error("Сохранённая попытка отсутствует — сначала обновите историю");
      } else {
        if (frozen) throw new Error("Сначала дождитесь результата текущей операции");
        const items = kind === "refund" ? refundItems() : closingItems();
        const summary = kind === "refund" ? `Вернуть ${money(amount)}? Деньги будут возвращены покупателю.` : "Сформировать чек полного расчёта на все оставшиеся товары с фактически отсканированными кодами?";
        if (!window.confirm(`${summary} Это не приём возврата на склад и не оформление отправления.`)) return;
        saved = retainFiscalAttempt(window.sessionStorage, {
          payment_id: paymentId, kind,
          body: { idempotency_key: window.crypto.randomUUID(), items,
            ...(kind === "refund" ? { receipt_mode: preview.receipt_mode, ...(note.trim() ? { note: note.trim() } : {}) } : {}) },
        });
      }
      setAttempt(saved);
      const endpoint = saved.kind === "refund" ? "tbank-refunds" : "tbank-closing-receipt";
      const { refund } = await sdk.client.fetch<{ refund: RefundResult }>(`/admin/payments/${encodeURIComponent(saved.payment_id)}/${endpoint}`, { method: "POST", body: saved.body });
      setLastResult(refund.operation);
      // Preserve the exact attempt until an explicit acknowledgement, including after timeouts.
      setReload((value) => value + 1);
    } catch (e) {
      if (saved && isDefinitiveRequestRejection(e)) {
        try { setAttempt(rejectFiscalAttempt(window.sessionStorage, saved)); }
        catch { setError("Не удалось сохранить отказ. Не создавайте новую операцию; проверьте историю."); return; }
        setPreview(undefined);
        setReload((value) => value + 1);
      }
      setError(e instanceof Error ? e.message : "Не удалось получить результат. Обновите статус или повторите ту же попытку.");
    } finally {
      inFlight.current = false; setBusy(false);
      if (saved?.kind === "refund") {
        void queryClient.invalidateQueries({ queryKey: ["orders", "detail", order.id] });
      }
    }
  }

  if (!loading && !error && paymentIds.length === 0) return null;
  return <Container className="space-y-4">
    <Heading level="h2">Т-Банк: возврат и фискальные чеки</Heading>
    <p className="text-sm text-ui-fg-subtle">Только деньги и чеки. Приём товара и остатки оформляйте штатным возвратом Medusa отдельно. Изменение доставки не формирует чек полного расчёта.</p>
    {paymentIds.length > 0 && <div className="space-y-2"><Label htmlFor={`fiscal-payment-${order.id}`}>Оплаченный платёж заказа</Label>
      <select id={`fiscal-payment-${order.id}`} className={fieldClass} value={paymentId} disabled={busy} onChange={(event) => setPaymentId(event.target.value)}>
        {paymentIds.map((id) => <option key={id} value={id}>{id}</option>)}
      </select></div>}
    {loading && <p role="status">Загрузка фискальных данных…</p>}
    {error && <p role="alert">{error}</p>}
    <Button variant="secondary" disabled={busy || loading} onClick={() => {
      setReload((value) => value + 1);
      void queryClient.invalidateQueries({ queryKey: ["orders", "detail", order.id] });
    }}>Обновить статус и историю</Button>
    {preview && <>
      <p>Оплачено: {money(preview.paid_amount_kopecks)}. Доступно к возврату: {money(preview.refundable_amount_kopecks)}.</p>
      <p>Основание чека: {preview.receipt_mode === "full_payment" ? "Полный расчёт — подтверждён закрывающий чек" : "Предоплата"}.</p>
      {blocked && <p role="alert">Есть незавершённая денежная операция или неподтверждённая фискализация. Новые операции заблокированы; обновляйте статус. Не создавайте возврат с новым ключом.</p>}
      <div className="space-y-3">{lines.map((line) => <fieldset key={line.line_index} disabled={frozen} className="space-y-2 rounded border p-3">
        <legend>Строка чека {line.line_index + 1}: {line.name}</legend>
        <p className="text-sm">{money(line.price_kopecks)} за единицу · В исходном чеке: {line.quantity} · Доступно: {line.available_quantity} · {line.payment_object === "service" ? "Услуга" : "Товар"}</p>
        <Label htmlFor={`fiscal-quantity-${paymentId}-${line.line_index}`}>Количество к возврату</Label>
        <Input id={`fiscal-quantity-${paymentId}-${line.line_index}`} type="number" min={0} max={line.available_quantity} step={1} value={quantities[line.line_index] ?? 0}
          onChange={(event) => setQuantities((values) => ({ ...values, [line.line_index]: Number(event.target.value) }))} />
        {preview.receipt_mode === "full_payment" && line.payment_object === "commodity" && line.available_quantity > 0 && <div className="space-y-2">
          <p className="text-sm">Выберите реальные коды возвращаемых единиц из закрывающего чека. Коды не создаются автоматически.</p>
          {(line.available_mark_codes ?? []).map((code, index) => <label key={code} className="flex items-start gap-2 text-sm">
            <input type="checkbox" checked={(selectedCodes[line.line_index] ?? []).includes(code)} onChange={(event) => setSelectedCodes((values) => ({ ...values,
              [line.line_index]: event.target.checked ? [...(values[line.line_index] ?? []), code] : (values[line.line_index] ?? []).filter((value) => value !== code),
            }))} /><span className="break-all">Код {index + 1}: <code>{code}</code></span>
          </label>)}
          {!line.available_mark_codes?.length && <p role="alert">Нет доступных сохранённых кодов. Частичный возврат этой строки недоступен.</p>}
        </div>}
      </fieldset>)}</div>
      <div className="flex flex-wrap gap-2"><Button variant="secondary" disabled={frozen || !remainingLines.length} onClick={() => {
        setQuantities(Object.fromEntries(lines.map((line) => [line.line_index, line.available_quantity])));
        setSelectedCodes(Object.fromEntries(lines.map((line) => [line.line_index, [...(line.available_mark_codes ?? [])]])));
      }}>Выбрать весь доступный остаток</Button><Button variant="secondary" disabled={frozen} onClick={() => { setQuantities({}); setSelectedCodes({}); }}>Снять выбор</Button></div>
      <Label htmlFor={`fiscal-note-${paymentId}`}>Причина возврата (необязательно)</Label>
      <Textarea id={`fiscal-note-${paymentId}`} value={note} maxLength={1000} disabled={frozen} onChange={(event) => setNote(event.target.value)} />
      <p className="font-medium">Сумма выбранного возврата: {money(Number.isFinite(amount) ? amount : 0)}</p>
      <Button disabled={frozen || !Number.isSafeInteger(amount) || amount <= 0} isLoading={busy} onClick={() => void submit("refund")}>Вернуть выбранную положительную сумму</Button>
      {preview.closing_available && <section className="space-y-3 rounded border p-3">
        <Heading level="h3">Чек полного расчёта на весь оставшийся товар</Heading>
        <p className="text-sm">Сканируйте фактические DataMatrix, по одному коду на строку, сохраняя разделители сканера. Закрываются все оставшиеся позиции, не частичная отгрузка.</p>
        {remainingLines.filter((line) => line.payment_object === "commodity").map((line) => <div key={line.line_index} className="space-y-2">
          <Label htmlFor={`fiscal-scan-${paymentId}-${line.line_index}`}>{line.name} — отсканировать {line.available_quantity} шт.</Label>
          <Textarea id={`fiscal-scan-${paymentId}-${line.line_index}`} disabled={frozen} value={scannedCodes[line.line_index] ?? ""} autoComplete="off" spellCheck={false}
            onChange={(event) => setScannedCodes((values) => ({ ...values, [line.line_index]: event.target.value }))} />
        </div>)}
        <Button variant="secondary" disabled={frozen || !remainingLines.length} onClick={() => void submit("closing")}>Сформировать закрывающий чек</Button>
      </section>}
      {!preview.closing_available && preview.closing_unavailable_reason && <p className="text-sm">Закрывающий чек недоступен: {preview.closing_unavailable_reason}</p>}
      {attempt && <section className="space-y-2 rounded border p-3">
        <p>Сохранённая попытка: {attempt.kind === "refund" ? "возврат" : "закрывающий чек"} · <code>{attempt.body.idempotency_key}</code></p>
        <p className="text-sm">Повтор отправляет ровно тот же запрос с тем же ключом. При неизвестном результате не начинайте новую операцию.</p>
        {attemptOperation && <p role="status">{stateLabels[attemptOperation.state]} · {fiscalLabels[attemptOperation.fiscal_state]}{attemptOperation.error_code ? ` · ${attemptOperation.error_code}` : ""}</p>}
        <Button variant="secondary" disabled={busy || loading || canClear} onClick={() => void submit(attempt.kind, true)}>Повторить ту же попытку безопасно</Button>
        {canClear && <Button variant="secondary" disabled={busy} onClick={() => {
          try { clearFiscalAttempt(window.sessionStorage, paymentId); setAttempt(null); setLastResult(undefined); setReload((value) => value + 1); }
          catch { setError("Не удалось очистить сохранённую попытку"); }
        }}>Результат проверен — перейти к новой операции</Button>}
      </section>}
      <Heading level="h3">История операций</Heading>
      {!preview.operations.length && <p className="text-sm">Операций ещё нет.</p>}
      <ul className="space-y-3">{preview.operations.map((operation) => <li key={operation.id} className="rounded border p-3 text-sm">
        <p>{operation.kind === "refund" ? "Возврат" : "Полный расчёт"} · {money(operation.amount_kopecks)} · {operation.created_at}</p>
        <p>{stateLabels[operation.state]} · {fiscalLabels[operation.fiscal_state]}</p>
        <p>ID: {operation.id} · Ключ: {operation.idempotency_key}{operation.native_refund_id ? ` · Medusa refund: ${operation.native_refund_id}` : ""}</p>
        {operation.error_code && <p role="alert">Код ошибки: {operation.error_code}</p>}
      </li>)}</ul>
    </>}
  </Container>;
};

export const config = defineWidgetConfig({ zone: "order.details.after" });
export default OrderFiscalRefund;
