import { useState } from "react"
import { Link } from "react-router-dom"
import { defineRouteConfig } from "@medusajs/admin-sdk"
import { SquaresPlus } from "@medusajs/icons"
import { Badge, Button, Container, Heading, Text, toast, usePrompt } from "@medusajs/ui"
import { useQueryClient } from "@tanstack/react-query"
import { ADMIN_SECTIONS, storeSidebarConfiguration } from "../../../lib/admin-navigation"
import { sdk } from "../../lib/sdk"

const WorkspacePage = () => {
  const [busy, setBusy] = useState(false)
  const prompt = usePrompt()
  const queryClient = useQueryClient()
  async function applyMenu() {
    const confirmed = await prompt({ title: "Применить меню магазина?", description: "Обновится общее меню команды. Данные магазина и личные настройки других сотрудников не изменятся.", confirmText: "Применить", cancelText: "Отмена" })
    if (!confirmed) return
    setBusy(true)
    try {
      await sdk.client.fetch("/admin/layouts/sidebar/configuration", { method: "POST", body: { is_default: true, configuration: storeSidebarConfiguration() } })
      // Medusa uses both flat list keys and nested keys for zone preferences.
      await queryClient.invalidateQueries({ predicate: ({ queryKey }) => queryKey[0] === "layouts" || (Array.isArray(queryKey[0]) && queryKey[0][0] === "layouts") })
      toast.success("Меню магазина применено")
    } catch {
      toast.error("Не удалось сохранить меню. Проверьте права доступа и повторите попытку.")
    } finally { setBusy(false) }
  }
  return <Container className="p-0">
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-ui-border-base px-6 py-5">
      <div><Text size="small" className="mb-1 text-ui-fg-subtle">Mario Mikke</Text><Heading level="h1">Рабочее пространство</Heading></div>
      <Button variant="secondary" disabled={busy} isLoading={busy} onClick={() => void applyMenu()}>Применить меню магазина</Button>
    </header>
    <div className="grid gap-x-8 divide-y divide-ui-border-base px-6 md:grid-cols-2">
      {ADMIN_SECTIONS.filter(section => section.path !== "/workspace").map(section => <Link key={section.path} to={section.path} className="flex min-w-0 items-center justify-between gap-3 py-4 text-sm hover:text-ui-fg-interactive">
        <span className="min-w-0 break-words font-medium">{section.label}</span>
        <Badge color={section.state === "available" ? "green" : "grey"}>{section.state === "available" ? "Доступно" : "В разработке"}</Badge>
      </Link>)}
    </div>
  </Container>
}
export const config = defineRouteConfig({ label: "Обзор", icon: SquaresPlus, rank: 0 })
export default WorkspacePage
