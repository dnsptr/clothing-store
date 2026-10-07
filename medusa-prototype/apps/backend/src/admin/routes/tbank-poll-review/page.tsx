import { useCallback, useEffect, useState } from "react"
import { defineRouteConfig } from "@medusajs/admin-sdk"
import { FetchError } from "@medusajs/js-sdk"
import { DocumentText } from "@medusajs/icons"
import { Button, Container, Heading, Input, Label, Table, Text, toast, usePrompt } from "@medusajs/ui"

import { sdk } from "../../lib/sdk"

const BASE = "/admin/tbank/payment-attempts/manual-review"
const PAGE_SIZE = 20

type Attempt = {
  id: string
  order_id: string
  payment_session_id: string
  provider_id: string
  expected_amount_kopecks: number
  currency_code: string
  poll_state: string
  poll_next_at: string | null
  poll_consecutive_errors: number
  poll_manual_review_at: string | null
  poll_retry_until: string | null
  poll_alert_sent_at: string | null
  created_at: string
  updated_at: string
}

type PaymentSession = {
  id: string
  status: string
  amount: number
  currency_code: string
  provider_id: string
}

type ReviewAction = {
  id: string
  action: string
  operator_id: string
  reason: string
  created_at: string
}

type Details = {
  paymentAttempt: Attempt
  paymentSession: PaymentSession | null
  actions: ReviewAction[]
}

const date = (value: string | null | undefined) =>
  value ? new Date(value).toLocaleString("ru-RU") : "—"

const formatRubles = (rubles: number, currency: string) =>
  `${rubles.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency.toUpperCase()}`

const message = (error: unknown) => error instanceof Error ? error.message : "Не удалось выполнить запрос"

const PollReviewPage = () => {
  const [offset, setOffset] = useState(0)
  const [queueRevision, setQueueRevision] = useState(0)
  const [revision, setRevision] = useState(0)
  const [attempts, setAttempts] = useState<Attempt[]>([])
  const [count, setCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [queueError, setQueueError] = useState("")
  const [selected, setSelected] = useState<string | null>(null)
  const [details, setDetails] = useState<Details | null>(null)
  const [detailsLoading, setDetailsLoading] = useState(false)
  const [detailsError, setDetailsError] = useState("")
  const [reason, setReason] = useState("")
  const [actionError, setActionError] = useState("")
  const [busy, setBusy] = useState<"confirm" | "retry" | "resolve" | null>(null)
  const prompt = usePrompt()
  const refresh = useCallback(() => setRevision((current) => current + 1), [])

  useEffect(() => {
    let active = true
    setLoading(true)
    setQueueError("")
    sdk.client.fetch<{ attempts: Attempt[]; count: number }>(BASE, {
      query: { offset, limit: PAGE_SIZE },
    }).then((data) => {
      if (!active) return
      setAttempts(data.attempts)
      setCount(data.count)
      if (offset > 0 && offset >= data.count) setOffset(Math.max(0, Math.ceil(data.count / PAGE_SIZE) - 1) * PAGE_SIZE)
    }).catch((error) => {
      if (active) setQueueError(message(error))
    }).finally(() => {
      if (active) setLoading(false)
    })
    return () => { active = false }
  }, [offset, revision, queueRevision])

  useEffect(() => {
    if (!selected) { setDetails(null); setDetailsError(""); return }
    let active = true
    setDetails(null)
    setDetailsLoading(true)
    setDetailsError("")
    sdk.client.fetch<{ details: Details }>(`${BASE}/${encodeURIComponent(selected)}`).then((data) => {
      if (active) setDetails(data.details)
    }).catch((error) => {
      if (!active) return
      if (error instanceof FetchError && error.status === 409) {
        setDetailsError("Попытка уже не на ручной проверке. Очередь обновляется; откройте актуальную запись.")
        setQueueRevision((current) => current + 1)
      } else {
        setDetailsError(message(error))
      }
    }).finally(() => {
      if (active) setDetailsLoading(false)
    })
    return () => { active = false }
  }, [selected, revision])

  async function act(action: "retry" | "resolve") {
    if (!selected || busy || !details || details.paymentAttempt.poll_state !== "manual_review") return
    const trimmed = reason.trim()
    if (!trimmed) { setActionError("Укажите причину действия."); return }
    const expectedReviewAt = details.paymentAttempt.poll_manual_review_at
    if (!expectedReviewAt) { setActionError("Неизвестно время перехода на ручную проверку. Обновите детали."); return }
    setActionError("")
    setBusy("confirm")
    let confirmed = false
    try {
      confirmed = await prompt({
        title: action === "retry" ? "Повторить проверку платежа?" : "Подтвердить завершение проверки?",
        description: action === "retry"
          ? `Попытка ${selected}: проверка GetState будет возобновлена. Причина: ${trimmed}`
          : `Попытка ${selected}: сервер заново проверит статус в банке и наличие связанного с существующим заказом списания. Действие не создаёт заказ и не отменяет оплату. Без подтверждения и записи списания завершение невозможно. Причина: ${trimmed}`,
        confirmText: action === "retry" ? "Подтвердить повтор" : "Проверить и завершить",
        cancelText: "Отмена",
      })
    } catch (error) {
      setActionError(`Не удалось подтвердить действие: ${message(error)}`)
      setBusy(null)
      return
    }
    if (!confirmed) { setBusy(null); return }
    setBusy(action)
    try {
      await sdk.client.fetch(`${BASE}/${encodeURIComponent(selected)}/${action}`, {
        method: "POST", body: { reason: trimmed, expectedReviewAt },
      })
      toast.success(action === "retry" ? "Повторная проверка запрошена" : "Платёж проверен и завершён")
      setReason("")
      setSelected(null)
      refresh()
    } catch (error) {
      setActionError(error instanceof FetchError && error.status === 409
        ? `Проверка безопасности или состояния не прошла (409): ${message(error)}. Очередь и детали обновляются; проверьте их перед повторным действием.`
        : `Не удалось подтвердить результат операции: ${message(error)}. Обновите данные перед повторной попыткой.`)
      refresh()
    } finally {
      setBusy(null)
    }
  }

  return (
    <Container className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Heading level="h1">Платежи Т-Банка: ручная проверка GetState</Heading>
          <Text className="text-ui-fg-subtle">Попытки, для которых автоматическая проверка статуса остановилась. Решение принимается только после проверки банком и БД.</Text>
        </div>
        <Button variant="secondary" onClick={refresh} disabled={busy !== null}>Обновить</Button>
      </div>

      {loading && <Text role="status">Загрузка очереди…</Text>}
      {queueError && <div role="alert" className="space-y-2"><Text className="text-ui-fg-error">Не удалось загрузить очередь: {queueError}</Text><Button variant="secondary" onClick={refresh}>Повторить</Button></div>}
      {!loading && !queueError && attempts.length === 0 && <Text>Очередь ручной проверки пуста.</Text>}
      {!loading && !queueError && attempts.length > 0 && (
        <Table>
          <Table.Header><Table.Row><Table.HeaderCell>ID платёжной сессии</Table.HeaderCell><Table.HeaderCell>Попытка</Table.HeaderCell><Table.HeaderCell>Ожидаемая сумма</Table.HeaderCell><Table.HeaderCell>На проверке с</Table.HeaderCell><Table.HeaderCell /></Table.Row></Table.Header>
          <Table.Body>{attempts.map((attempt) => (
            <Table.Row key={attempt.id}>
              <Table.Cell>{attempt.order_id}</Table.Cell>
              <Table.Cell>{attempt.id}</Table.Cell>
              <Table.Cell>{formatRubles(attempt.expected_amount_kopecks / 100, attempt.currency_code)}</Table.Cell>
              <Table.Cell>{date(attempt.poll_manual_review_at)}</Table.Cell>
              <Table.Cell><Button size="small" variant="secondary" disabled={busy !== null} onClick={() => { setSelected(attempt.id); setReason(""); setActionError("") }}>Открыть</Button></Table.Cell>
            </Table.Row>
          ))}</Table.Body>
        </Table>
      )}
      {!queueError && <div className="flex items-center gap-3">
        <Button variant="secondary" disabled={loading || offset === 0} onClick={() => setOffset((value) => Math.max(0, value - PAGE_SIZE))}>Назад</Button>
        <Text>{count ? `${offset + 1}–${Math.min(offset + PAGE_SIZE, count)} из ${count}` : "0 записей"}</Text>
        <Button variant="secondary" disabled={loading || offset + PAGE_SIZE >= count} onClick={() => setOffset((value) => value + PAGE_SIZE)}>Далее</Button>
      </div>}

      {selected && <section className="space-y-4 border-t pt-5" aria-label="Детали попытки">
        <div className="flex items-center justify-between gap-3"><Heading level="h2">Попытка {selected}</Heading><Button variant="secondary" disabled={busy !== null} onClick={() => { setSelected(null); setReason(""); setActionError("") }}>Вернуться к очереди</Button></div>
        {actionError && <Text role="alert" className="text-ui-fg-error">{actionError}</Text>}
        {detailsLoading && <Text role="status">Загрузка деталей…</Text>}
        {detailsError && <div role="alert" className="space-y-2"><Text className="text-ui-fg-error">Не удалось загрузить детали: {detailsError}</Text><Button variant="secondary" onClick={refresh}>Повторить</Button></div>}
        {details && !detailsLoading && !detailsError && <>
          <dl className="grid gap-3 md:grid-cols-2">
            <div><dt>ID платёжной сессии</dt><dd>{details.paymentAttempt.order_id}</dd></div>
            <div><dt>Провайдер попытки</dt><dd>{details.paymentAttempt.provider_id}</dd></div>
            <div><dt>Ожидаемая сумма</dt><dd>{formatRubles(details.paymentAttempt.expected_amount_kopecks / 100, details.paymentAttempt.currency_code)}</dd></div>
            <div><dt>Состояние проверки</dt><dd>{details.paymentAttempt.poll_state}</dd></div>
            <div><dt>Ошибок проверки подряд</dt><dd>{details.paymentAttempt.poll_consecutive_errors}</dd></div>
            <div><dt>На ручной проверке с</dt><dd>{date(details.paymentAttempt.poll_manual_review_at)}</dd></div>
            <div><dt>Создана</dt><dd>{date(details.paymentAttempt.created_at)}</dd></div>
            <div><dt>Следующая проверка</dt><dd>{date(details.paymentAttempt.poll_next_at)}</dd></div>
            <div><dt>Окно повторной проверки до</dt><dd>{date(details.paymentAttempt.poll_retry_until)}</dd></div>
          </dl>
          {details.paymentSession
            ? <div className="space-y-1"><Heading level="h3">Сессия Medusa</Heading><Text>Статус: {details.paymentSession.status}; сумма: {formatRubles(details.paymentSession.amount, details.paymentSession.currency_code)}; провайдер: {details.paymentSession.provider_id}</Text></div>
            : <Text className="text-ui-fg-error">Сессия Medusa не найдена. Завершение без связанного с заказом списания невозможно.</Text>}
          <div className="space-y-3">
            <Heading level="h3">Действия сотрудника</Heading>
            {details.actions.length === 0 ? <Text>Действий пока нет.</Text> : <ul className="space-y-2">{details.actions.map((action) => <li key={action.id} className="border-b pb-2"><Text>{date(action.created_at)} · {action.action} · {action.operator_id}</Text><Text>Причина: {action.reason}</Text></li>)}</ul>}
          </div>
          {details.paymentAttempt.poll_state === "manual_review" ? <div className="space-y-3 border-t pt-4">
            <div><Label htmlFor="poll-review-reason">Причина действия (обязательно)</Label><Input id="poll-review-reason" value={reason} onChange={(event) => { setReason(event.target.value); setActionError("") }} disabled={busy !== null} /></div>
            <Text className="text-ui-fg-subtle">Сначала обычно выбирают «Повторить проверку»: это возобновляет ограниченное по времени чтение GetState. «Проверить и завершить» требует нового подтверждения банком и сохранённого списания, связанного с существующим заказом. Ни одно действие не создаёт заказ, не создаёт списание и не отменяет оплату.</Text>
            {busy && <Text role="status">{busy === "confirm" ? "Ожидание подтверждения…" : busy === "resolve" ? "Банк и база данных проверяются…" : "Запрос повторной проверки выполняется…"}</Text>}
            <div className="flex flex-wrap gap-2"><Button variant="secondary" disabled={busy !== null || !reason.trim()} onClick={() => void act("retry")}>Повторить проверку</Button><Button disabled={busy !== null || !reason.trim()} onClick={() => void act("resolve")}>Проверить и завершить</Button></div>
          </div> : <Text role="status">Попытка больше не на ручной проверке. Обновите очередь перед следующим действием.</Text>}
        </>}
      </section>}
    </Container>
  )
}

export const config = defineRouteConfig({ label: "Т-Банк: проверка GetState", icon: DocumentText })
export default PollReviewPage
