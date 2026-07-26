import Medusa from "@medusajs/js-sdk"

/**
 * SDK instance for admin extensions.
 *
 * The dashboard is served by the Medusa server itself, so a relative base url
 * keeps requests on the same origin the admin was loaded from. That matters
 * here specifically: in production Caddy puts HTTP basic auth in front of
 * `/app*`, and an absolute url pointing somewhere else would drop both the
 * basic-auth credentials and the session cookie.
 */
export const sdk = new Medusa({
  baseUrl: import.meta.env.VITE_BACKEND_URL || "/",
  debug: import.meta.env.DEV,
  auth: { type: "session" },
})
