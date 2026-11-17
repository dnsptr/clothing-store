import { defineRouteConfig } from "@medusajs/admin-sdk"
import { Buildings } from "@medusajs/icons"
import { WorkspaceSection } from "../../components/workspace-section"

const Page = () => <WorkspaceSection section="stock" />
export const config = defineRouteConfig({ label: "Остатки и резервы", icon: Buildings, rank: 60 })
export default Page
