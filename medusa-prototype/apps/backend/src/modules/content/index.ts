import { Module } from "@medusajs/framework/utils"

import ContentModuleService from "./service"

export const CONTENT_MODULE = "content"

export { CONTENT_SECTIONS } from "./models/content-slide"
export type { ContentSection } from "./models/content-slide"

export default Module(CONTENT_MODULE, {
  service: ContentModuleService,
})
