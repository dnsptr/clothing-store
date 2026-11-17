import { defineRouteConfig } from "@medusajs/admin-sdk"
import { Users } from "@medusajs/icons"
import { WorkspaceSection } from "../../components/workspace-section"

const Page = () => <WorkspaceSection section="team" />
export const config = defineRouteConfig({ label: "Сотрудники и доступ", icon: Users, rank: 120 })
export default Page
