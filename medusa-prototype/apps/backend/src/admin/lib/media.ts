/**
 * Root-relative media belongs to the storefront's public directory, not to the
 * Medusa origin that serves the admin. Uploaded files already have an absolute
 * URL and must stay untouched.
 */
export function resolveMediaPreviewUrl(url: string, storefrontUrl: string): string {
  if (!url.startsWith("/")) return url

  const origin = storefrontUrl.replace(/\/+$/, "")
  return origin ? `${origin}${url}` : url
}
