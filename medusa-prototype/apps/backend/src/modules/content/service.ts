import { MedusaService } from "@medusajs/framework/utils"

import ContentSlide from "./models/content-slide"

/**
 * MedusaService generates the CRUD surface from the models it is given:
 * `listContentSlides`, `listAndCountContentSlides`, `retrieveContentSlide`,
 * `createContentSlides`, `updateContentSlides`, `deleteContentSlides`.
 *
 * Anything beyond plain CRUD belongs here as an explicit method rather than in
 * a route handler, so the storefront and the admin cannot drift apart on what
 * "the published home page" means.
 */
class ContentModuleService extends MedusaService({ ContentSlide }) {}

export default ContentModuleService
