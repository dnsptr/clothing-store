import type { ExecArgs, ISettingsModuleService } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { storeSidebarConfiguration } from "../lib/admin-navigation"

export default async function setupAdminMenu({ container }: ExecArgs) {
  const settings = container.resolve<ISettingsModuleService>(Modules.SETTINGS)
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  await settings.setSystemDefaultLayoutConfiguration("sidebar", storeSidebarConfiguration())
  logger.info("Mario Mikke: team sidebar configured. Personal layouts were preserved.")
}
