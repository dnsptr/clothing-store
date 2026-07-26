import { loadEnv, defineConfig, Modules } from '@medusajs/framework/utils'

loadEnv(process.env.NODE_ENV || 'development', process.cwd())

const REDIS_URL = process.env.REDIS_URL
const IS_PRODUCTION = process.env.NODE_ENV === 'production'
const IS_BUILD = process.argv.some((arg) => arg === 'build')

/**
 * Redis is mandatory in production. Without it Medusa silently falls back to the
 * in-memory ("Local") Event Bus and the in-memory Locking provider, which drop
 * queued events on restart and cannot coordinate concurrent operations across
 * workers or instances. Fail fast rather than boot an unsafe production setup.
 */
if (IS_PRODUCTION && !REDIS_URL && !IS_BUILD) {
  throw new Error(
    'REDIS_URL is required in production. It powers the Redis Event Bus, Workflow ' +
      'Engine, Cache and Locking modules. Set REDIS_URL (e.g. ' +
      'redis://:password@host:6379) and restart the backend.'
  )
}

/**
 * Redis-backed infrastructure modules. Registered only when REDIS_URL is present.
 * In development without Redis this list stays empty, so Medusa keeps its built-in
 * in-memory defaults and the backend still boots without a running Redis server.
 */
const redisModules = REDIS_URL
  ? [
      {
        // Durable, cross-worker event delivery (BullMQ) — replaces the Local Event Bus.
        key: Modules.EVENT_BUS,
        resolve: '@medusajs/event-bus-redis',
        options: {
          redisUrl: REDIS_URL,
        },
      },
      {
        // Persists workflow/step state across restarts and enables distributed execution.
        key: Modules.WORKFLOW_ENGINE,
        resolve: '@medusajs/workflow-engine-redis',
        options: {
          redis: {
            redisUrl: REDIS_URL,
          },
        },
      },
      {
        // Shared cache across all workers/instances instead of per-process memory.
        key: Modules.CACHE,
        resolve: '@medusajs/cache-redis',
        options: {
          redisUrl: REDIS_URL,
        },
      },
      {
        // Locking module using the Redis provider as the default — distributed locks
        // that prevent races during concurrent operations (replaces in-memory locking).
        key: Modules.LOCKING,
        resolve: '@medusajs/locking',
        options: {
          providers: [
            {
              resolve: '@medusajs/locking-redis',
              id: 'locking-redis',
              is_default: true,
              options: {
                redisUrl: REDIS_URL,
              },
            },
          ],
        },
      },
    ]
  : []

/**
 * Home page editorial content (hero slides, category shortcuts, material and
 * store cards, the promo banner). Registered unconditionally — unlike the Redis
 * modules it has no infrastructure prerequisite, and the storefront's home page
 * depends on it in every environment.
 */
const contentModule = {
  resolve: './src/modules/content',
}

const PUBLIC_BACKEND_URL = process.env.PUBLIC_BACKEND_URL

/**
 * Fail fast rather than accept uploads addressed as localhost. The value is
 * baked into each file's stored url at upload time, so a wrong or missing one
 * is repaired by a data migration, not by fixing the environment later.
 */
if (IS_PRODUCTION && !PUBLIC_BACKEND_URL && !IS_BUILD) {
  throw new Error(
    'PUBLIC_BACKEND_URL is required in production. Uploaded files store an ' +
      'absolute url at upload time, so without it every upload would be ' +
      'permanently addressed as http://localhost:9000. Set it to the public ' +
      'origin of this backend (e.g. https://api.mariomikke.shop).'
  )
}

/**
 * Medusa already registers a File module by default, but it does so with NO
 * provider options, which leaves the local provider's `backend_url` at its
 * built-in `http://localhost:9000/static`. Declaring the module here overrides
 * that default (user modules are appended after the defaults and win on key
 * collision), so uploads carry the right origin from the very first one.
 *
 * The local provider is documented by its own authors as development only:
 * files are served by the Node process, and nothing under `static/` is private
 * — anything there is readable by whoever knows the filename. It is adequate
 * while the client fills the home page with content and inadequate for the long
 * run. Moving media to object storage (roadmap 4.1) means swapping the provider
 * below for `@medusajs/medusa/file-s3`; content rows store the provider's file
 * `key` next to the url precisely so that swap stays a configuration change.
 */
const fileModule = {
  key: Modules.FILE,
  resolve: '@medusajs/medusa/file',
  options: {
    providers: [
      {
        resolve: '@medusajs/medusa/file-local',
        id: 'local',
        options: {
          // Must match how the files are actually served: Caddy proxies every
          // path through to Medusa, which serves `static/` at `/static`.
          backend_url: `${PUBLIC_BACKEND_URL ?? 'http://localhost:9000'}/static`,
        },
      },
    ],
  },
}

module.exports = defineConfig({
  projectConfig: {
    databaseUrl: process.env.DATABASE_URL,
    redisUrl: process.env.REDIS_URL,
    http: {
      storeCors: process.env.STORE_CORS!,
      adminCors: process.env.ADMIN_CORS!,
      authCors: process.env.AUTH_CORS!,
      jwtSecret: process.env.JWT_SECRET,
      cookieSecret: process.env.COOKIE_SECRET,
    }
  },
  modules: [...redisModules, fileModule, contentModule],
})
