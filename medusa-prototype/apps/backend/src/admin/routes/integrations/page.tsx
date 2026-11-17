import { defineRouteConfig } from "@medusajs/admin-sdk"
import { SquaresPlus } from "@medusajs/icons"
import { useEffect, useState } from "react"
import { Badge, Button, Container, Heading, Text } from "@medusajs/ui"
import { sdk } from "../../lib/sdk"

type ExchangeFile = { name: string; bytes: number; status: "received" | "validated" | "invalid"; summary?: { version: string; products: number; offers: number; warehouseElements: number; priceTypes: number } }
type Journal = { enabled: boolean; mode: "dry_run"; sessions: { id: string; createdAt: string; complete: boolean; expired: boolean; files: ExchangeFile[] }[] }
const statuses = { received: "Получен", validated: "XML проверен", invalid: "Ошибка XML" }

const Page = () => {
  const [data, setData] = useState<Journal | null>(null)
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(true)
  const [refresh, setRefresh] = useState(0)
  useEffect(() => {
    let active = true
    setLoading(true)
    sdk.client.fetch<Journal>("/admin/onec-exchange").then(data => { if (active) { setData(data); setError("") } }).catch(() => { if (active) setError("Не удалось загрузить журнал обмена") }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [refresh])
  return <Container className="p-0">
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-ui-border-base px-6 py-5">
      <Heading level="h1">Интеграции и обмен</Heading>
      <Button variant="secondary" disabled={loading} onClick={() => setRefresh(value => value + 1)}>Обновить</Button>
    </header>
    <section className="space-y-3 border-b border-ui-border-base px-6 py-5">
      <div className="flex flex-wrap items-center gap-3"><Heading level="h2">1С · CommerceML</Heading><Badge color="grey">Только проверка</Badge>{data && <Badge color={data.enabled ? "green" : "grey"}>{data.enabled ? "Приём включён" : "Приём выключен"}</Badge>}</div>
      <Text size="small">Товары, цены и остатки не изменяются. Успешная проверка XML не означает загрузку данных в каталог.</Text>
      <Text size="small" className="text-ui-fg-subtle">Заказы, резервирование, ZIP и изображения в этом обмене не поддерживаются.</Text>
    </section>
    {error && <p role="alert" className="px-6 py-4 text-ui-fg-error">{error}</p>}
    {loading && <p role="status" className="px-6 py-4">Загрузка журнала...</p>}
    {!loading && !error && !data?.sessions.length && <p className="px-6 py-12 text-center text-ui-fg-subtle">Сеансов обмена пока нет</p>}
    {data?.sessions.map(session => <section key={session.id} className="border-b border-ui-border-base last:border-b-0">
      <div className="flex flex-wrap items-center justify-between gap-2 px-6 py-4 text-sm"><span>Сеанс {session.id.slice(0, 10)} · {new Date(session.createdAt).toLocaleString("ru-RU")}</span><Badge color="grey">{session.complete ? "Проверка завершена" : session.expired ? "Сеанс истёк" : "Сеанс открыт"}</Badge></div>
      {session.files.length ? <div className="overflow-x-auto"><table className="w-full min-w-[650px] text-left text-sm"><thead className="text-ui-fg-subtle"><tr>{["Файл", "Размер", "Проверка", "Содержимое XML"].map(label => <th key={label} className="px-6 py-3 font-medium">{label}</th>)}</tr></thead><tbody>{session.files.map(file => <tr key={file.name} className="border-t border-ui-border-base"><td className="px-6 py-3">{file.name}</td><td className="px-6 py-3">{new Intl.NumberFormat("ru-RU").format(file.bytes)} Б</td><td className="px-6 py-3">{statuses[file.status]}</td><td className="px-6 py-3">{file.summary ? `Версия ${file.summary.version}; товаров: ${file.summary.products}; предложений: ${file.summary.offers}; элементов складов: ${file.summary.warehouseElements}; типов цен: ${file.summary.priceTypes}` : "—"}</td></tr>)}</tbody></table></div> : <p className="px-6 pb-5 text-sm text-ui-fg-subtle">Файлы ещё не получены</p>}
    </section>)}
  </Container>
}

export const config = defineRouteConfig({ label: "Интеграции и обмен", icon: SquaresPlus, rank: 130 })
export default Page
