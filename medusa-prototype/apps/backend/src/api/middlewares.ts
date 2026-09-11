import {
  defineMiddlewares,
  validateAndTransformBody,
} from "@medusajs/framework/http";

import {
  CreateSlideSchema,
  ReorderSchema,
  UpdateSlideSchema,
} from "./admin/content/validators";
import { catalogProfileGuard } from "./admin/catalog-profile-guard";

/**
 * Штатный роут `/hooks/payment/:provider` объявляет `preserveRawBody`
 * (`@medusajs/medusa/dist/api/hooks/middlewares.js`). Наш роут его перекрывает,
 * поэтому настройку надо воспроизвести осознанно, а не унаследовать: без неё
 * `req.rawBody` был бы `undefined`.
 *
 * Подписи Т-Банка сырое тело не требуется — токен считается по разобранным
 * полям, а не по байтам (§5.4). Но `rawData` уходит в событие, форму которого
 * читает штатный сабскрайбер, и терять его при переходе на свой роут незачем.
 *
 * Body validation for the content admin routes.
 *
 * The handlers read `req.validatedBody`, which only exists once one of these
 * middlewares has run — a route added here without its matcher would read
 * `undefined` rather than fail loudly, so every write route below has an entry.
 */
export default defineMiddlewares({
  routes: [
    {
      matcher: "/admin/products/:id",
      method: "POST",
      middlewares: [catalogProfileGuard],
    },
    {
      matcher: "/admin/products",
      method: "POST",
      middlewares: [catalogProfileGuard],
    },
    {
      method: ["POST"],
      bodyParser: { preserveRawBody: true },
      matcher: "/hooks/payment/tbank",
    },
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
});
