import { defineRouteConfig } from "@medusajs/admin-sdk"
import { Users } from "@medusajs/icons"
import { WorkspaceSection } from "../../components/workspace-section"

const Page = () => <WorkspaceSection section="buyers" />
export const config = defineRouteConfig({ label: "Покупатели", icon: Users, rank: 70 })
export default Page
