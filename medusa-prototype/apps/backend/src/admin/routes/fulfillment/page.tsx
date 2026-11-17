import { defineRouteConfig } from "@medusajs/admin-sdk"
import { ShoppingCart } from "@medusajs/icons"
import { WorkspaceSection } from "../../components/workspace-section"

const Page = () => <WorkspaceSection section="fulfillment" />
export const config = defineRouteConfig({ label: "Оплата и доставка", icon: ShoppingCart, rank: 15 })
export default Page
