import { defineRouteConfig } from "@medusajs/admin-sdk"
import { ReceiptPercent } from "@medusajs/icons"
import { WorkspaceSection } from "../../components/workspace-section"

const Page = () => <WorkspaceSection section="discounts" />
export const config = defineRouteConfig({ label: "Акции и промокоды", icon: ReceiptPercent, rank: 80 })
export default Page
