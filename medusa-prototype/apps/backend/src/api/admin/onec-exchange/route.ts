import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { exchangeConfig, ExchangeStore } from "../../../lib/onec/exchange";

export async function GET(_req: MedusaRequest, res: MedusaResponse): Promise<void> {
  res.setHeader("Cache-Control", "no-store");
  try {
    const config = exchangeConfig();
    const store = new ExchangeStore(config);
    const sessions = config.enabled ? await store.locked(() => store.journal()) : [];
    res.json({ enabled: config.enabled, mode: "dry_run", sessions });
  } catch {
    res.status(503).json({ message: "Журнал обмена недоступен. Проверьте настройки и доступ к хранилищу." });
  }
}
