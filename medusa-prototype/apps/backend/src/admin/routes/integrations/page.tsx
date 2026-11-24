import { useEffect, useState } from "react";
import { defineRouteConfig } from "@medusajs/admin-sdk";
import { SquaresPlus } from "@medusajs/icons";
import { Badge, Button, Container, Heading, Text } from "@medusajs/ui";
import { sdk } from "../../lib/sdk";
import { OnecPreview } from "../../components/onec-preview";

type ExchangeJournal = {
  enabled: boolean;
  mode: "dry_run";
  authority?: "1c";
  articles?: string[];
  sessions: {
    id: string; createdAt: string; updatedAt: string; complete: boolean; expired: boolean; mode: "dry_run";
    files: { name: string; bytes: number; status: "received" | "validated" | "invalid"; sha256?: string;
      summary?: { version: string; products: number; offers: number; warehouseElements: number; priceTypes: number } }[];
  }[];
};
const statusLabels = { received: "Получен", validated: "XML проверен", invalid: "Ошибка XML" };

const IntegrationsPage = () => {
  const [data, setData] = useState<ExchangeJournal>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true);
    sdk.client.fetch<ExchangeJournal>("/admin/onec-exchange").then((journal) => {
      if (active) { setData(journal); setError(""); }
    }).catch(() => { if (active) setError("Не удалось загрузить журнал обмена"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [reload]);

  return <Container className="p-0">
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-ui-border-base px-6 py-5">
      <Heading level="h1">Интеграции и обмен</Heading>
      <Button variant="secondary" disabled={loading} onClick={() => setReload((value) => value + 1)}>Обновить</Button>
    </header>
    <section className="space-y-3 border-b border-ui-border-base px-6 py-5">
    <div className="flex flex-wrap items-center gap-3">
      <Heading level="h2">1С · CommerceML</Heading>
      <Badge color="grey">Только проверка</Badge>
      {data && <Badge color={data.enabled ? "green" : "grey"}>{data.enabled ? "Приём включён" : "Приём выключен"}</Badge>}
    </div>
    <Text>Товары, цены и остатки не изменяются. Успешная проверка XML не означает загрузку данных в каталог.</Text>
    <Text className="text-ui-fg-subtle">Заказы, резервирование, ZIP и изображения в этом обмене не поддерживаются.</Text>
    {data?.articles && <div className="space-y-2 text-sm"><p>Основной источник цен, характеристик и остатков: 1С.</p><p className="break-words">Ассортимент ({data.articles.length}): {data.articles.join(", ")}</p></div>}
    </section>
    {data && <OnecPreview sessions={data.sessions} />}
    {error && <p role="alert" className="px-6 py-4 text-ui-fg-error">{error}</p>}
    {loading && <p role="status" className="px-6 py-4">Загрузка журнала…</p>}
    {!loading && !error && data && !data.sessions.length && <p className="px-6 py-12 text-center text-ui-fg-subtle">Сеансов обмена пока нет.</p>}
    {data?.sessions.map((session) => <section key={session.id} className="border-b border-ui-border-base last:border-b-0">
      <div className="flex flex-wrap items-center gap-3 px-6 py-4">
        <Badge color={session.complete ? "green" : "grey"}>{session.complete ? "Проверка завершена" : session.expired ? "Сеанс истёк" : "Приём файлов"}</Badge>
        <Text>{new Date(session.createdAt).toLocaleString("ru-RU")}</Text>
      </div>
      <code className="block break-all px-6 pb-4 text-xs">{session.id}</code>
      {session.files.length ? <div className="overflow-x-auto">
        <table className="w-full min-w-[650px] text-left text-sm">
          <caption className="sr-only">Файлы сеанса обмена {session.id}</caption>
          <thead className="text-ui-fg-subtle"><tr>{["Файл", "Размер", "Проверка", "Содержимое XML"].map((label) => <th key={label} className="px-6 py-3 font-medium">{label}</th>)}</tr></thead>
          <tbody>{session.files.map((file) => <tr key={file.name} className="border-t border-ui-border-base">
            <td className="px-6 py-3">
              <Text>{file.name}</Text>
              {file.sha256 && <code className="block break-all text-xs">SHA-256: {file.sha256}</code>}
            </td>
            <td className="px-6 py-3">{new Intl.NumberFormat("ru-RU").format(file.bytes)} Б</td>
            <td className="px-6 py-3">{statusLabels[file.status]}</td>
            <td className="px-6 py-3">{file.summary ? `CommerceML ${file.summary.version} · Товаров: ${file.summary.products} · Предложений: ${file.summary.offers} · Элементов складов: ${file.summary.warehouseElements} · Типов цен: ${file.summary.priceTypes}` : "—"}</td>
          </tr>)}</tbody>
        </table>
      </div> : <p className="px-6 pb-5 text-sm text-ui-fg-subtle">Файлы ещё не получены</p>}
    </section>)}
  </Container>;
};

export const config = defineRouteConfig({ label: "Интеграции и обмен", icon: SquaresPlus, rank: 130 });
export default IntegrationsPage;
