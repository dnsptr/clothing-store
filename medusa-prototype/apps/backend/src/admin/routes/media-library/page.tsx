import { defineRouteConfig } from "@medusajs/admin-sdk"
import { Photo } from "@medusajs/icons"
import { WorkspaceSection } from "../../components/workspace-section"

const Page = () => <WorkspaceSection section="media-library" />
export const config = defineRouteConfig({ label: "Медиатека", icon: Photo, rank: 45 })
export default Page
