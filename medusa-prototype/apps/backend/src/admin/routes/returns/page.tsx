import { defineRouteConfig } from "@medusajs/admin-sdk"
import { DocumentText } from "@medusajs/icons"
import { WorkspaceSection } from "../../components/workspace-section"

const Page = () => <WorkspaceSection section="returns" />
export const config = defineRouteConfig({ label: "Возвраты и претензии", icon: DocumentText, rank: 30 })
export default Page
