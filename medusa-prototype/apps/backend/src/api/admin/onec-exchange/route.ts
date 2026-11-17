import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ExchangeStore, exchangeConfig } from "../../../lib/onec/exchange"

export async function GET(_req: MedusaRequest, res: MedusaResponse) {
  res.setHeader("Cache-Control", "no-store")
  try {
    const config = exchangeConfig()
    const sessions = config.enabled ? await new ExchangeStore(config).locked(() => new ExchangeStore(config).journal()) : []
    res.json({ enabled: config.enabled, mode: "dry_run", sessions })
  } catch {
    res.status(503).json({ message: "Журнал обмена недоступен. Проверьте настройки и доступ к хранилищу." })
  }
}
