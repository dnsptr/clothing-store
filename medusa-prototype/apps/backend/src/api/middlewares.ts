import { defineMiddlewares, validateAndTransformBody } from "@medusajs/framework/http"

import {
  CreateSlideSchema,
  ReorderSchema,
  UpdateSlideSchema,
} from "./admin/content/validators"

/**
 * Body validation for the content admin routes.
 *
 * The handlers read `req.validatedBody`, which only exists once one of these
 * middlewares has run — a route added here without its matcher would read
 * `undefined` rather than fail loudly, so every write route below has an entry.
 */
export default defineMiddlewares({
  routes: [
    {
      matcher: "/admin/content/slides",
      method: "POST",
      middlewares: [validateAndTransformBody(CreateSlideSchema)],
    },
    {
      matcher: "/admin/content/slides/:id",
      method: "POST",
      middlewares: [validateAndTransformBody(UpdateSlideSchema)],
    },
    {
      matcher: "/admin/content/reorder",
      method: "POST",
      middlewares: [validateAndTransformBody(ReorderSchema)],
    },
  ],
})
