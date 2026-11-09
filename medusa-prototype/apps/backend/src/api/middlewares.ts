import {
  authenticate,
  authorize,
  defineMiddlewares,
  validateAndTransformBody,
  validateAndTransformQuery,
} from "@medusajs/framework/http";
import { PolicyOperation } from "@medusajs/framework/utils";

import {
  CreateSlideSchema,
  ReorderSchema,
  UpdateSlideSchema,
} from "./admin/content/validators";
import { catalogProfileGuard } from "./admin/catalog-profile-guard";
import {
  ManualReviewActionSchema,
  ManualReviewListQuerySchema,
} from "./admin/tbank/manual-review/validators";
import { UpdateHandoffRegistrySchema } from "./admin/dispatch-points/validators";
import { withFulfillmentHandoffContext } from "./admin/orders/fulfillment-handoff";

import { requirePaidPaymentProvider, requireCheckoutDelivery, requireCapturedCart, requirePaidOrderForFulfillment } from "./store/payment-provider-guard";
import { requireCheckoutAccess, requireInlineCartAddresses } from "./store/checkout-access-guard";
import { requireUnchangedPaymentCart } from "./store/payment-cart-guard";

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
      matcher: "/admin/dispatch-points",
      method: "GET",
      middlewares: [authorize([{ resource: "stock_location", operation: PolicyOperation.read }])],
    },
    {
      matcher: "/admin/dispatch-points/:id",
      method: "POST",
      middlewares: [authorize([{ resource: "stock_location", operation: PolicyOperation.update }]), validateAndTransformBody(UpdateHandoffRegistrySchema)],
    },
    { matcher: "/store/carts", method: "POST", middlewares: [requireInlineCartAddresses] },
    { matcher: "/store/carts/:id", method: "POST", middlewares: [requireInlineCartAddresses] },
    { matcher: "/store/carts/*", middlewares: [requireCheckoutAccess, requireUnchangedPaymentCart] },
    { matcher: "/store/payment-status/*", middlewares: [requireCheckoutAccess] },
    { matcher: "/store/carts/:id/complete", method: "POST", middlewares: [requireCapturedCart] },
    { matcher: "/admin/orders/:id/fulfillments", method: "POST", middlewares: [requirePaidOrderForFulfillment, withFulfillmentHandoffContext] },
    { matcher: "/store/payment-collections", method: "POST", middlewares: [requireCheckoutAccess] },
    { matcher: "/store/payment-collections/*", middlewares: [requireCheckoutAccess] },
    { matcher: "/store/shipping-options", method: "GET", middlewares: [requireCheckoutAccess] },
    { matcher: "/store/yandex/calculate", method: "POST", middlewares: [requireCheckoutAccess] },
    {
      matcher: "/store/orders/:id",
      method: "GET",
      middlewares: [authenticate("customer", ["session", "bearer"], { allowUnauthenticated: true }), requireCheckoutAccess],
    },
    {
      matcher: "/store/orders/:id/transfer/request",
      method: "POST",
      middlewares: [authenticate("customer", ["session", "bearer"], { allowUnauthenticated: true }), requireCheckoutAccess],
    },
    {
      matcher: "/store/orders/:id/transfer/cancel",
      method: "POST",
      middlewares: [authenticate("customer", ["session", "bearer"], { allowUnauthenticated: true }), requireCheckoutAccess],
    },
    {
      matcher: "/store/payment-collections/:id/payment-sessions",
      method: "POST",
      middlewares: [requirePaidPaymentProvider, requireCheckoutDelivery],
    },
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
    {
      matcher: "/admin/tbank/manual-review/:id/retry",
      method: "POST",
      middlewares: [validateAndTransformBody(ManualReviewActionSchema)],
    },
    {
      matcher: "/admin/tbank/manual-review/:id/resolve",
      method: "POST",
      middlewares: [validateAndTransformBody(ManualReviewActionSchema)],
    },
    {
      matcher: "/admin/tbank/manual-review",
      method: "GET",
      middlewares: [
        validateAndTransformQuery(ManualReviewListQuerySchema, { isList: false }),
      ],
    },
  ],
});
