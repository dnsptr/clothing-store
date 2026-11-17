import { defineRouteConfig } from "@medusajs/admin-sdk"
import { DocumentText } from "@medusajs/icons"
import { WorkspaceSection } from "../../components/workspace-section"

const Page = () => <WorkspaceSection section="communications" />
export const config = defineRouteConfig({ label: "Уведомления", icon: DocumentText, rank: 100 })
export default Page
