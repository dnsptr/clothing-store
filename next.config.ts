import type { NextConfig } from "next";

// Two build targets share this config.
//
//   default (Vercel)   — server rendering + ISR. Product pages are produced on
//                        demand, so a product created in Medusa Admin gets a
//                        page without a redeploy. next/image optimisation is on.
//   BUILD_TARGET=pages — static export of the mock demo for GitHub Pages. No
//                        server, no checkout (README → "Environments").
//
// CI builds BOTH targets on purpose: a regression in the export target is
// otherwise invisible until the Pages deploy fails.
const isPagesExport = process.env.BUILD_TARGET === "pages";

// basePath/assetPrefix belong to the Pages export only. On Vercel the app is
// served from the domain root and a stray basePath would break every asset URL.
const githubPagesBasePath = isPagesExport
  ? process.env.NEXT_PUBLIC_BASE_PATH ??
    (process.env.GITHUB_ACTIONS === "true" ? "/clothing-store" : "")
  : "";

// Build-time guard for the export target only. In a static export the public
// variables are inlined into the bundle, so a missing key can only be caught
// here. On the server target the same variables are read per request
// (src/lib/medusa.ts) — that is precisely what lets an env change take effect
// without a rebuild, so a build-time throw there would reintroduce the coupling
// this change removes. The server target fails loudly at request time instead.
if (
  isPagesExport &&
  process.env.NEXT_PUBLIC_DATA_MODE === "medusa" &&
  (!process.env.NEXT_PUBLIC_MEDUSA_BACKEND_URL ||
    !process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY)
) {
  throw new Error(
    "Static export in medusa mode requires NEXT_PUBLIC_MEDUSA_BACKEND_URL and " +
      "NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY at build time.",
  );
}

// Route handlers cannot exist in a static export: there is no server to run
// them, and Next rejects any handler that is not a `force-static` GET — a POST
// endpoint can never be exported at all. Server-only handlers are therefore
// gated behind an extension that only the server target recognises: a
// `route.node.ts` file is a route on Vercel and an ordinary, unrouted module in
// the Pages export. URLs are unaffected, because the route path comes from the
// directory, not the filename.
const pageExtensions = isPagesExport
  ? ["tsx", "ts", "jsx", "js"]
  : ["node.tsx", "node.ts", "node.jsx", "node.js", "tsx", "ts", "jsx", "js"];

/**
 * Hosts the image optimiser is allowed to fetch product media from.
 *
 * `remotePatterns` is build-time configuration — Next cannot re-read it per
 * request — so this is the one place where a backend/CDN move still requires a
 * redeploy. Derived from the configured backend plus an explicit override list
 * (`MEDIA_ALLOWED_ORIGINS`, comma-separated) so the S3 migration (task 4.1) is
 * a variable change rather than a code change.
 */
function mediaRemotePatterns() {
  const origins = [
    process.env.MEDUSA_BACKEND_URL,
    process.env.NEXT_PUBLIC_MEDUSA_BACKEND_URL,
    ...(process.env.MEDIA_ALLOWED_ORIGINS?.split(",") ?? []),
  ];

  const patterns = new Map<string, { protocol: "http" | "https"; hostname: string; port: string }>();
  for (const origin of origins) {
    const trimmed = origin?.trim();
    if (!trimmed) continue;
    try {
      const { protocol, hostname, port } = new URL(trimmed);
      if (protocol !== "http:" && protocol !== "https:") continue;
      patterns.set(`${protocol}//${hostname}:${port}`, {
        protocol: protocol === "https:" ? "https" : "http",
        hostname,
        port,
      });
    } catch {
      // A malformed origin must not take the build down; it simply grants no
      // permission, and the resulting image request fails visibly in review.
      console.warn(`[next.config] Ignored malformed media origin: ${trimmed}`);
    }
  }

  return [...patterns.values()];
}

/**
 * Заголовки безопасности серверной цели.
 *
 * До этого витрина не отдавала ни одного: ни защиты от встраивания в чужой
 * iframe, ни запрета MIME-sniffing, ни политики Referer — при том что через неё
 * проходят адрес, телефон и e-mail покупателя.
 *
 * `frame-ancestors` задан именно через CSP: в отличие от `X-Frame-Options`, он
 * работает во всех современных браузерах и не конфликтует с будущей полной
 * политикой. Директивы `script-src`/`style-src` сюда осознанно не входят — без
 * nonce они ломают инлайновые стили и скрипты Next; полноценная CSP требует
 * middleware с nonce и делается отдельной задачей.
 *
 * `headers()` не поддерживается в статическом экспорте — там заголовки задаёт
 * тот, кто раздаёт файлы (GitHub Pages), поэтому цель `pages` их не объявляет.
 */
const securityHeaders = [
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), interest-cohort=()" },
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
];

const nextConfig: NextConfig = {
  ...(isPagesExport ? { output: "export" as const } : {}),
  // Версия Next в заголовке ответа — бесплатная подсказка о том, какие CVE
  // пробовать.
  poweredByHeader: false,
  ...(isPagesExport
    ? {}
    : {
        async headers() {
          return [{ source: "/:path*", headers: securityHeaders }];
        },
      }),
  // Без этой строки весь механизм `route.node.ts` выше был мёртвым: константа
  // вычислялась и никуда не передавалась, поэтому такой файл не стал бы роутом
  // ни в одной из целей сборки. Обнаружить это можно было только по
  // отсутствующему эндпоинту — комментарий рядом уверенно описывал работающее
  // поведение.
  pageExtensions,
  images: isPagesExport
    ? // No optimiser exists in a static export.
      { unoptimized: true }
    : { remotePatterns: mediaRemotePatterns() },
  basePath: githubPagesBasePath || undefined,
  assetPrefix: githubPagesBasePath || undefined,
  env: {
    NEXT_PUBLIC_BASE_PATH: githubPagesBasePath,
  },
};

export default nextConfig;
