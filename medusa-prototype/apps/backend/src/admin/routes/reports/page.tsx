import { defineRouteConfig } from "@medusajs/admin-sdk"
import { DocumentText } from "@medusajs/icons"
import { WorkspaceSection } from "../../components/workspace-section"

const Page = () => <WorkspaceSection section="reports" />
export const config = defineRouteConfig({ label: "Отчёты и аналитика", icon: DocumentText, rank: 110 })
export default Page
