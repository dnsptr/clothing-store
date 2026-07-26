import { defineMiddlewares } from "@medusajs/framework/http";

/**
 * Штатный роут `/hooks/payment/:provider` объявляет `preserveRawBody`
 * (`@medusajs/medusa/dist/api/hooks/middlewares.js`). Наш роут его перекрывает,
 * поэтому настройку надо воспроизвести осознанно, а не унаследовать: без неё
 * `req.rawBody` был бы `undefined`.
 *
 * Подписи Т-Банка сырое тело не требуется — токен считается по разобранным
 * полям, а не по байтам (§5.4). Но `rawData` уходит в событие, форму которого
 * читает штатный сабскрайбер, и терять его при переходе на свой роут незачем.
 */
export default defineMiddlewares({
  routes: [
    {
      method: ["POST"],
      bodyParser: { preserveRawBody: true },
      matcher: "/hooks/payment/tbank",
    },
  ],
});
