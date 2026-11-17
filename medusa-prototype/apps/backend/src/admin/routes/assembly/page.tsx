import { defineRouteConfig } from "@medusajs/admin-sdk"
import { Buildings } from "@medusajs/icons"
import { WorkspaceSection } from "../../components/workspace-section"

const Page = () => <WorkspaceSection section="assembly" />
export const config = defineRouteConfig({ label: "Сборка заказов", icon: Buildings, rank: 20 })
export default Page
