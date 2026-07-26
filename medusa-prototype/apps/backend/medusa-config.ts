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
 * Платёжный провайдер Т-Банка.
 *
 * Регистрируется только при заданных ключах терминала. Причина в том, что
 * `validateOptions` провайдера бросает на пустом `terminalKey`, и без этого
 * условия бэкенд перестал бы стартовать у всех, кто ключей не имеет: в
 * dev-окружении, в CI и на сборке. Отсутствие провайдера — рабочее состояние
 * до получения терминала, отсутствие бэкенда — нет.
 *
 * Следствие, которое надо помнить при развёртывании: пока переменные не
 * заданы, в регионе доступен только `pp_system_default`, а он завершает
 * корзину без единого рубля списания. Витрина это состояние распознаёт и
 * закрывает чекаут (`src/lib/medusa.ts`, `isCheckoutEnabled`).
 */
const TBANK_TERMINAL_KEY = process.env.TBANK_TERMINAL_KEY
const TBANK_PASSWORD = process.env.TBANK_PASSWORD

const paymentModule =
  TBANK_TERMINAL_KEY && TBANK_PASSWORD
    ? [
        {
          resolve: '@medusajs/medusa/payment',
          options: {
            providers: [
              {
                resolve: './src/modules/tbank',
                id: 'tbank',
                options: {
                  terminalKey: TBANK_TERMINAL_KEY,
                  password: TBANK_PASSWORD,
                  // Тестовый и боевой терминалы различаются только базовым URL.
                  apiBaseUrl: process.env.TBANK_API_BASE_URL,
                  successUrl: process.env.TBANK_SUCCESS_URL,
                  failUrl: process.env.TBANK_FAIL_URL,
                  notificationUrl: process.env.TBANK_NOTIFICATION_URL,
                },
              },
            ],
          },
        },
      ]
    : []

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
  modules: [...redisModules, ...paymentModule],
})
