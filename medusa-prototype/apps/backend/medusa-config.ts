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

/**
 * Журнал нотификаций Т-Банка регистрируется ВСЕГДА, в отличие от самого
 * провайдера. Схема базы не должна зависеть от переменных окружения: иначе
 * staging и production разъезжаются по структуре, а миграция, применённая на
 * одном стенде, на другом не существует. Пустая таблица ничего не стоит.
 */
const tbankNotificationModule = [{ resolve: './src/modules/tbank-notifications' }]

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

/**
 * Уведомления.
 *
 * Модуль регистрируется всегда — у него своя таблица, а схема БД не должна
 * зависеть от переменных окружения. Провайдер Telegram добавляется только при
 * заданном токене: его `validateOptions` бросает на пустом значении, и без
 * условия бэкенд не стартовал бы там, где токена нет.
 *
 * `notification-local` остаётся всегда: он пишет уведомление в лог вместо
 * отправки, поэтому в разработке и в CI цепочка «заказ → уведомление»
 * проверяется целиком, без внешнего сервиса.
 */
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN

/**
 * Почта (SMTP).
 *
 * Провайдер добавляется, только когда заданы все четыре обязательные
 * переменные: его `validateOptions` бросает на любой пустой, и бэкенд не
 * стартовал бы там, где почтового ящика ещё нет — в разработке, в CI, на сборке.
 *
 * Канал в модуле уведомлений может обслуживать ровно один провайдер: загрузчик
 * падает с «Multiple providers are configured for the same channel». Поэтому
 * `email` переходит от `local` к SMTP-провайдеру, когда тот настроен, а `local`
 * сужается до `feed`. Без переменных всё остаётся как было: `local` держит оба
 * канала и пишет письма в лог, так что цепочка «заказ → письмо» проверяется без
 * почтового хостинга.
 */
const SMTP_HOST = process.env.SMTP_HOST
const SMTP_USER = process.env.SMTP_USER
const SMTP_PASSWORD = process.env.SMTP_PASSWORD
const SMTP_FROM = process.env.SMTP_FROM
const SMTP_PORT = process.env.SMTP_PORT
const SMTP_SECURE = process.env.SMTP_SECURE

const HAS_SMTP = Boolean(SMTP_HOST && SMTP_USER && SMTP_PASSWORD && SMTP_FROM)

const notificationModule = [
  {
    resolve: '@medusajs/medusa/notification',
    options: {
      providers: [
        {
          resolve: '@medusajs/medusa/notification-local',
          id: 'local',
          options: { channels: HAS_SMTP ? ['feed'] : ['email', 'feed'] },
        },
        ...(HAS_SMTP
          ? [
              {
                resolve: './src/modules/email-smtp',
                id: 'email-smtp',
                options: {
                  channels: ['email'],
                  host: SMTP_HOST,
                  // Порт и режим TLS не угадываются: у Unisender, Mail.ru и
                  // Яндекса они разные. Пустое значение оставляем пустым —
                  // провайдер сам возьмёт 587 и выведет TLS из порта.
                  port: SMTP_PORT ? Number(SMTP_PORT) : undefined,
                  secure: SMTP_SECURE ? SMTP_SECURE === 'true' : undefined,
                  user: SMTP_USER,
                  password: SMTP_PASSWORD,
                  from: SMTP_FROM,
                },
              },
            ]
          : []),
        ...(TELEGRAM_BOT_TOKEN
          ? [
              {
                resolve: './src/modules/telegram',
                id: 'telegram',
                options: {
                  channels: ['telegram'],
                  botToken: TELEGRAM_BOT_TOKEN,
                  defaultChatId: process.env.TELEGRAM_CHAT_ID,
                },
              },
            ]
          : []),
      ],
    },
  },
]

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
  modules: [
    ...redisModules,
    ...tbankNotificationModule,
    ...notificationModule,
    ...paymentModule,
  ],
})
