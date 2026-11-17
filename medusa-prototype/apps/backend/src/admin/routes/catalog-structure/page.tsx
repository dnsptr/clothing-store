import { defineRouteConfig } from "@medusajs/admin-sdk"
import { Tag } from "@medusajs/icons"
import { WorkspaceSection } from "../../components/workspace-section"

const Page = () => <WorkspaceSection section="catalog-structure" />
export const config = defineRouteConfig({ label: "Категории и коллекции", icon: Tag, rank: 50 })
export default Page
