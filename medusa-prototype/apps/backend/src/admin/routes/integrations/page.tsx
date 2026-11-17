import { useEffect, useState } from "react";
import { defineRouteConfig } from "@medusajs/admin-sdk";
import { Badge, Button, Container, Heading, Text } from "@medusajs/ui";
import { sdk } from "../../lib/sdk";

type ExchangeJournal = {
  enabled: boolean;
  mode: "dry_run";
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

  return <Container className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <Heading level="h1">Интеграции и обмен</Heading>
      <Button variant="secondary" disabled={loading} onClick={() => setReload((value) => value + 1)}>Обновить</Button>
    </div>
    <div className="flex flex-wrap items-center gap-3">
      <Heading level="h2">1С · CommerceML</Heading>
      <Badge color="grey">Только проверка</Badge>
      {data && <Badge color={data.enabled ? "green" : "grey"}>{data.enabled ? "Приём включён" : "Приём выключен"}</Badge>}
    </div>
    <Text>Товары, цены и остатки не изменяются. Успешная проверка XML не означает загрузку данных в каталог.</Text>
    <Text className="text-ui-fg-subtle">Заказы, резервирование, ZIP и изображения в этом обмене не поддерживаются.</Text>
    {error && <p role="alert">{error}</p>}
    {loading && <p role="status">Загрузка журнала…</p>}
    {data && !data.sessions.length && <Text>Сеансов обмена пока нет.</Text>}
    {data?.sessions.map((session) => <section key={session.id} className="space-y-3 rounded border border-ui-border-base p-4">
      <div className="flex flex-wrap items-center gap-3">
        <Badge color={session.complete ? "green" : "grey"}>{session.complete ? "Проверка завершена" : session.expired ? "Сеанс истёк" : "Приём файлов"}</Badge>
        <Text>{new Date(session.createdAt).toLocaleString("ru-RU")}</Text>
      </div>
      <code className="block break-all text-xs">{session.id}</code>
      {session.files.map((file) => <div key={file.name} className="space-y-1 border-t border-ui-border-base pt-3">
        <Text>{file.name} · {file.bytes} байт · {statusLabels[file.status]}</Text>
        {file.summary && <Text>CommerceML {file.summary.version} · Товаров: {file.summary.products} · Предложений: {file.summary.offers} · Элементов складов: {file.summary.warehouseElements} · Типов цен: {file.summary.priceTypes}</Text>}
        {file.sha256 && <code className="block break-all text-xs">SHA-256: {file.sha256}</code>}
      </div>)}
    </section>)}
  </Container>;
};

export const config = defineRouteConfig({ label: "Интеграции и обмен" });
export default IntegrationsPage;
