# Mario Mikke: технический roadmap

Актуально на 19 июля 2026 года. Базовый commit: `f6418e4`.

## 1. Назначение документа

Этот документ фиксирует фактическое состояние проекта, целевую архитектуру и порядок дальнейшей разработки. План разбит на небольшие независимые задачи: одна задача должна иметь ограниченную область изменений, проверяемый результат и отдельный review.

Roadmap не предполагает немедленного удаления моков. Моки сохраняются как fixtures и как явно выбранный локальный режим до завершения соответствующей API- и frontend-интеграции. В staging и production не должно быть скрытого fallback на тестовые товары.

## 2. Правила работы

1. Одна микрозадача — один логически цельный PR.
2. Перед задачей фиксируются цель, границы и критерии приёмки.
3. Backend endpoint, его тесты и подключение frontend выполняются отдельными задачами.
4. Нельзя смешивать инфраструктуру, бизнес-логику и визуальные изменения в одном PR без необходимости.
5. Цена, скидка, налог, остаток и итог заказа всегда подтверждаются backend.
6. Production не маскирует ошибку API моковыми данными.
7. Любая внешняя интеграция обязана поддерживать timeout, retry, idempotency и reconciliation.
8. Секреты не передаются в чат и не попадают в Git.
9. Изменение схемы БД сопровождается migration и проверяемым rollback/restore сценарием.
10. Задача считается завершённой только после автоматических проверок и smoke test.

## 3. Текущий baseline

### 3.1 Репозиторий

| Область             | Состояние                                                           |
| ------------------- | ------------------------------------------------------------------- |
| Ветка               | `main` синхронизирована с `origin/main` на `f6418e4`                |
| Storefront          | Next.js 16.2.10, React 19, App Router, TypeScript                   |
| Режим frontend      | `output: "export"`, GitHub Pages, client-side загрузка Medusa       |
| Backend             | Medusa 2.17.2 в `medusa-prototype/apps/backend`                     |
| Данные              | 12 demo-товаров, RUB region, варианты size/color, demo inventory    |
| Интеграция          | Read-only каталог Medusa подключён через `CatalogProvider`          |
| Корзина             | React Context + `localStorage`, не Medusa Cart                      |
| Checkout/Auth       | UI-заглушки без создания заказа и сессии                            |
| Deployment          | Dockerfile, production Compose, Caddy, Cloudflare Quick Tunnel      |
| Проверки            | Frontend lint, typecheck и build проходят                           |
| Локальные изменения | `package.json` и `tsconfig.json` содержат незакоммиченный `DEV-001` |

Ключевые точки кода:

- статический export: `next.config.ts`;
- Medusa adapter: `src/lib/medusa.ts`;
- fallback каталога: `src/context/CatalogContext.tsx`;
- локальная корзина: `src/context/CartContext.tsx`;
- фиктивный checkout: `src/app/checkout/CheckoutClient.tsx`;
- фиктивный account: `src/app/account/AccountClient.tsx`;
- импорт каталога: `medusa-prototype/apps/backend/src/scripts/import-mario-mikke.ts`;
- production stack: `medusa-prototype/compose.production.yml`.

### 3.2 Staging-сервер

| Параметр             | Фактическое состояние                                                                                    |
| -------------------- | -------------------------------------------------------------------------------------------------------- |
| Провайдер            | Timeweb Cloud                                                                                            |
| ОС                   | Ubuntu 24.04.4 LTS                                                                                       |
| Ресурсы              | 2 vCPU, 3.8 GB RAM, 48 GB disk, 2 GB swap                                                                |
| Свободное место      | около 41 GB                                                                                              |
| SSH                  | ключевой доступ работает через alias `mario-mikke`                                                       |
| Linux-пользователь   | `deploy`, группы `deploy` и `docker`                                                                     |
| Firewall             | UFW: входящие `22`, `80`, `443`; остальное запрещено                                                     |
| Защита SSH           | Fail2ban активен; root разрешён только по ключу; глобальный `PasswordAuthentication` ещё нужно отключить |
| Docker               | Docker 29.1.3, Compose 2.40.3                                                                            |
| Deployment directory | `/opt/mario-mikke`, владелец `deploy:deploy`, mode `750`                                                 |
| Production env       | `/opt/mario-mikke/.env.production`, mode `600`                                                           |
| Medusa               | работает, `/health` возвращает `200 OK`                                                                  |
| PostgreSQL           | container healthy, опубликован только на `127.0.0.1:5432`                                                |
| Redis                | container healthy, опубликован только на `127.0.0.1:6379`                                                |
| Reverse proxy        | Caddy, сейчас HTTP-конфигурация                                                                          |
| Публичный доступ     | временный случайный Cloudflare Quick Tunnel                                                              |
| Backup               | не настроен                                                                                              |
| Source checkout      | `/opt/mario-mikke` не является Git checkout                                                              |

### 3.3 Завершённая первая часть

| ID      | Результат                                                                | Статус                             |
| ------- | ------------------------------------------------------------------------ | ---------------------------------- |
| DEV-001 | Frontend TypeScript отделён от Medusa tree, добавлен `npm run typecheck` | Выполнено локально, не закоммичено |
| INF-001 | Сервер проверен, ресурсы подтверждены                                    | Выполнено                          |
| INF-002 | SSH key authentication настроена                                         | Выполнено                          |
| INF-003 | Создан Linux-пользователь `deploy`                                       | Выполнено                          |
| INF-004 | Проверены UFW и Fail2ban                                                 | Выполнено                          |
| INF-005 | Проверены Docker и Compose                                               | Выполнено                          |
| INF-006 | Исправлены небезопасные права `777` на `/opt/mario-mikke`                | Выполнено                          |
| INF-007 | Проверены контейнеры и Medusa health endpoint                            | Выполнено                          |

## 4. Фактическая архитектура сейчас

```text
GitHub Pages / local Next.js static export
                |
                | browser GET /store/regions, /store/products
                v
Cloudflare Quick Tunnel (временный URL)
                |
                v
Medusa API/Admin :9000
        |                 |
        v                 v
PostgreSQL            Redis container
127.0.0.1:5432        127.0.0.1:6379
```

Redis container работает, но логи Medusa показывают `Local Event Bus` и `in-memory locking`. Следовательно, наличие `REDIS_URL` ещё не означает, что production Redis modules действительно настроены.

## 5. Критические риски

| Приоритет | Риск                                                            | Последствие                                                                          |
| --------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| P0        | PostgreSQL backup отсутствует                                   | Ошибка миграции или потеря volume приведёт к потере данных                           |
| P0        | Quick Tunnel имеет случайный URL                                | URL меняется после restart; невозможно надёжно настроить storefront, CORS и webhooks |
| P0        | Production storefront при ошибке Medusa молча показывает mocks  | Пользователь может увидеть и попытаться заказать demo-товар                          |
| P0        | Checkout, login и newsletter показывают ложный успех            | Пользователь считает заказ/вход/подписку выполненными без server action              |
| P0        | Корзина не хранит Medusa `variant_id`                           | Нельзя гарантировать существование выбранной size/color комбинации                   |
| P0        | Нет server-side totals, reservations, payment и fiscalization   | Реальные продажи запускать нельзя                                                    |
| P1        | Medusa использует local event bus и in-memory locking           | Потеря jobs и гонки при webhooks, inventory и нескольких процессах                   |
| P1        | Fresh deployment не полностью воспроизводим                     | Рабочее состояние сервера зависит от ручных seed/import действий                     |
| P1        | Catalog import удаляет и пересоздаёт товары                     | Меняются Medusa IDs, сбрасываются остатки, возможна порча связей заказов             |
| P1        | Нет стабильного HTTPS-домена                                    | Mixed content, нестабильные cookies, CORS и callback URLs                            |
| P1        | Нет S3 file provider                                            | Загруженные в container файлы потеряются после пересоздания                          |
| P1        | Три GitHub Pages workflow конкурируют                           | Нестабильный CI/deploy и лишние сборки                                               |
| P1        | `/opt/mario-mikke` не связан с Git/image registry               | Нет доказуемого commit/image и простого rollback                                     |
| P1        | Пользователь `deploy` входит в группу `docker`                  | Docker-доступ эквивалентен root; приватный deploy-ключ требует строгой защиты        |
| P2        | Demo taxonomy содержит ошибочные категории и размеры            | Некорректные фильтры и карточки товаров                                              |
| P2        | Cart и checkout используют разные цены доставки                 | Разные totals на соседних шагах                                                      |

## 6. Целевая архитектура первого production-релиза

```text
Internet
   |
   v
Caddy HTTPS :443
   |----------------------|
   v                      v
Next.js storefront       Medusa API/Admin
Node runtime в РФ        API process + worker/shared mode
                              |
            |-----------------|------------------|
            v                 v                  v
       PostgreSQL          Redis             S3 в РФ
            |                 |                  |
            v                 v                  v
      backup/PITR       jobs/locks/cache      media/CDN

Medusa integrations:
T-Банк + онлайн-касса | СДЭК | Яндекс | Email/Telegram | будущая 1С
```

Для текущих 2 vCPU / 4 GB сначала используется модульный монолит и shared worker mode. Отдельные микросервисы не требуются. Необходимо ввести resource limits и следить минимум за 20% свободной RAM и диска.

## 7. Roadmap

Обозначения статусов: `TODO`, `BLOCKED`, `PARTIAL`, `DONE`.

### Этап A. Закрыть baseline и защитить staging

| ID        | Зависит от | Микрозадача                                                 | Критерий приёмки                                                                               | Статус               |
| --------- | ---------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | -------------------- |
| GIT-001   | —          | Оформить `DEV-001` отдельным commit                         | В commit только `package.json` и `tsconfig.json`; lint/typecheck/build зелёные                 | TODO                 |
| GIT-002   | GIT-001    | Определить судьбу `.npm-cache/` и `.opencode/`              | Локальные артефакты не попадают в commit; worktree предсказуем                                 | TODO                 |
| SEC-002   | —          | Сбросить раскрытый root-пароль в панели провайдера          | Новый пароль не передан в чат; SSH по ключу продолжает работать                                | TODO                 |
| SEC-003   | SEC-002    | Проверить effective SSH policy                              | `PasswordAuthentication no`; root и deploy входят по ключам; новая сессия проверена до restart | TODO                 |
| SEC-004   | SEC-001    | Ограничить доступ к Medusa Admin                            | Выбран VPN/allowlist/MFA сценарий; `/app` не является незащищённой публичной панелью           | TODO                 |
| OPS-001   | —          | Сделать локальный PostgreSQL dump с retention 7 дней        | Создаётся проверяемый compressed dump; старые dumps удаляются автоматически                    | TODO                 |
| OPS-002   | OPS-001    | Отправлять backup в отдельный S3 bucket в РФ                | Backup хранится вне VPS; lifecycle и шифрование включены                                       | BLOCKED: нужен S3    |
| OPS-003   | OPS-002    | Провести restore drill                                      | Fresh PostgreSQL volume восстановлен; Medusa проходит smoke test                               | DONE локально (2026-07-27): критерий выполнен, `/health` `200`, все 144 таблицы совпали с источником — [протокол](docs/ops/restore-drill-2026-07-27.md). На сервере не повторено (OPS-004/OPS-005), внешней копии нет (OPS-002) |
| OPS-004   | —          | Подключить постоянный API-домен                             | DNS A/AAAA указывает на сервер; hostname согласован                                            | BLOCKED: нужен домен |
| OPS-005   | OPS-004    | Настроить Caddy HTTPS                                       | Сертификат валиден; HTTP перенаправляется на HTTPS; `/health` возвращает `200`                 | TODO                 |
| OPS-006   | OPS-005    | Удалить обязательную зависимость от Quick Tunnel            | Restart не меняет backend URL; cloudflared выключен в production profile                       | TODO                 |
| REDIS-001 | —          | Подключить Redis event bus, workflow engine/cache и locking | В логах нет `Local Event Bus` и `in-memory locking`; restart/smoke test проходят               | TODO                 |
| OBS-001   | —          | Настроить health, disk, RAM и container restart alerts      | Тестовый сбой создаёт уведомление; logs имеют rotation                                         | TODO                 |

### Этап B. Воспроизводимый backend и CI/CD

| ID       | Зависит от      | Микрозадача                                       | Критерий приёмки                                                                                           | Статус |
| -------- | --------------- | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------ |
| ADR-001  | —               | Зафиксировать основные invariants                 | Утверждены RUB, НДС-inclusive 5%, `ONE SIZE`, immutable SKU/external ID, РФ-first                          | TODO   |
| BOOT-001 | ADR-001         | Создать идемпотентный `bootstrap:ru`              | Пустая БД дважды получает store, RU region, sales channel, API key, shipping profile и location без дублей | TODO   |
| BOOT-002 | BOOT-001        | Удалить зависимость от европейского starter state | Store API не предлагает Europe/EUR/USD и Copenhagen warehouse                                              | TODO   |
| TEST-001 | BOOT-001        | Починить backend test harness                     | Jest setup существует; test-команды не завершаются с `0 tests` или missing setup                           | TODO   |
| TEST-002 | TEST-001        | Добавить bootstrap/import/API smoke tests         | Repeat bootstrap/import и Store API проверяются автоматически                                              | TODO   |
| CI-001   | GIT-001         | Оставить один CI workflow                         | Frontend lint/typecheck/build и backend lint/test/build выполняются один раз                               | TODO   |
| CI-002   | CI-001          | Добавить Docker image build                       | Каждый commit создаёт проверенный immutable image tag                                                      | TODO   |
| CD-001   | CI-002, OPS-005 | Настроить staging deploy через `deploy`           | Сервер pull-ит image, применяет migrations и выполняет health check без root                               | TODO   |
| CD-002   | CD-001          | Добавить rollback                                 | Предыдущий image tag поднимается одной документированной командой                                          | TODO   |
| DOC-001  | CD-002          | Обновить runbook                                  | Описаны deploy, rollback, backup, restore, secret rotation и incident response                             | TODO   |

### Этап C. Российская модель каталога, налогов и файлов

| ID         | Зависит от           | Микрозадача                                       | Критерий приёмки                                                                                  | Статус                                                         |
| ---------- | -------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| TAX-001    | ADR-001, BOOT-001    | Создать tax rate НДС 5%                           | Integration test: `Σ item_tax == order.tax_total`, расчёт по строке (ADR-001 §2)                  | PARTIAL: нет integration-теста `Σ item_tax == order.tax_total` |
| CAT-001    | ADR-001              | Описать catalog schema                            | Зафиксированы product, variant, SKU, color, `ONE SIZE`, composition, country, care и measurements | TODO                                                           |
| CAT-002    | CAT-001              | Исправить demo taxonomy                           | Платья, юбки, обувь и аксессуары имеют корректные категории и материалы                           | TODO                                                           |
| CAT-003    | CAT-001              | Хранить реальные variant combinations             | UI/API не создают комбинации size/color, которых нет в Medusa                                     | TODO                                                           |
| FILE-001   | OPS-002              | Подключить российский S3 provider                 | Upload/read/delete работают; container recreation не теряет media                                 | TODO                                                           |
| IMPORT-001 | CAT-001              | Заменить delete/recreate на upsert                | Повторный import сохраняет product/variant IDs и ручные данные                                    | TODO                                                           |
| IMPORT-002 | IMPORT-001, FILE-001 | Перенести demo media в S3                         | Все product URLs стабильны и не зависят от Next `public`                                          | TODO                                                           |
| STORE-001  | CAT-001              | Получить реестр физических магазинов              | Есть code, address, timezone, working hours и pickup capability                                   | TODO                                                           |
| STORE-002  | STORE-001, BOOT-001  | Создать Medusa StockLocation для каждого магазина | Location codes совпадают с master data; online channel links корректны                            | TODO                                                           |
| STOCK-001  | STORE-002            | Реализовать inventory по location                 | Остаток варианта хранится отдельно для каждого магазина                                           | TODO                                                           |
| STOCK-002  | STOCK-001            | Зафиксировать allocation policy без split         | Один заказ резервируется в одной location; невозможный заказ отклоняется                          | TODO                                                           |
| API-001    | STOCK-001            | Добавить публичный availability contract          | API отдаёт sellable availability без раскрытия служебных данных                                   | TODO                                                           |

### Этап D. Завершить read-only интеграцию storefront

| ID     | Зависит от         | Микрозадача                                      | Критерий приёмки                                                              | Статус |
| ------ | ------------------ | ------------------------------------------------ | ----------------------------------------------------------------------------- | ------ |
| FE-001 | OPS-005            | Перейти на self-hosted Next.js Node runtime в РФ | Storefront работает без `output: export`; headers/cookies/runtime доступны    | TODO   |
| FE-002 | FE-001             | Ввести явный `mock`/`medusa` data mode           | Local preview может использовать mocks; staging/production не делают fallback | TODO   |
| FE-003 | FE-002, IMPORT-001 | Типизировать Medusa client contract              | Ошибочный response не принимается как Product; errors диагностируются         | TODO   |
| FE-004 | FE-003             | Перевести catalog pagination/filtering на API    | Каталог не загружает весь ассортимент одним browser request                   | TODO   |
| FE-005 | FE-003             | Перевести product route на Medusa handle/ID      | Новый опубликованный Admin product открывается без rebuild                    | TODO   |
| FE-006 | FE-005, CAT-003    | Сделать variant selector                         | Выбирается конкретный `variant_id`; недоступные комбинации disabled           | TODO   |
| FE-007 | FE-004, FE-005     | Добавить loading/empty/error states              | API outage показывает controlled unavailable state, а не demo data            | TODO   |
| FE-008 | FE-004             | Подключить Medusa product grid на главной        | Главная использует API либо явно согласованный editorial source               | TODO   |
| FE-009 | API-001            | Подключить наличие по магазинам                  | PDP показывает актуальную доступность по выбранному варианту                  | TODO   |

### Этап E. Настоящая корзина и checkout

| ID           | Зависит от          | Микрозадача                               | Критерий приёмки                                                         | Статус                                                           |
| ------------ | ------------------- | ----------------------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| CART-001     | FE-006, TAX-001     | Создать/resume Medusa cart                | Browser хранит cart ID; region и currency задаются backend               | DONE (`df22a29`)                                                 |
| CART-002     | CART-001            | Добавлять line item по `variant_id`       | Нельзя добавить несуществующую size/color комбинацию                     | DONE (`df22a29`)                                                 |
| CART-003     | CART-002, STOCK-002 | Проверять количество и остаток            | Backend отклоняет oversell и пересчитывает availability                  | PARTIAL: нет теста отказа oversell и обработки ошибки на витрине |
| CART-004     | CART-002            | Перенести totals на Medusa                | Цена, tax, discount и total не вычисляются как источник истины в browser | DONE (`8ada740`)                                                 |
| PROMO-001    | CART-004            | Подключить промокоды Medusa               | Валидный код меняет server totals; ошибки отображаются корректно         | TODO                                                             |
| PROMO-002    | PROMO-001           | Зафиксировать stacking policy             | Sale, promo и loyalty сочетаются только по утверждённым правилам         | TODO                                                             |
| CHECKOUT-001 | CART-004            | Отправлять contacts/address в Medusa cart | Validation происходит на backend; данные сохраняются в order snapshot    | DONE (`b976ce5`)                                                 |
| CHECKOUT-002 | CHECKOUT-001        | Удалить fake submit                       | Экран успеха невозможен без созданного backend order                     | DONE (`e8fd55c`)                                                 |

### Этап F. Доставка

| ID         | Зависит от              | Микрозадача                                   | Критерий приёмки                                                  | Статус |
| ---------- | ----------------------- | --------------------------------------------- | ----------------------------------------------------------------- | ------ |
| SHIP-001   | CHECKOUT-001, STOCK-002 | Описать provider-neutral fulfillment contract | Courier/PVZ/pickup используют общий quote/status contract         | TODO   |
| CDEK-001   | SHIP-001                | Подключить sandbox CДЭК: города и ПВЗ         | Поиск и выбор ПВЗ работают по provider IDs                        | TODO   |
| CDEK-002   | CDEK-001                | Подключить CДЭК quote                         | Цена и срок доставки приходят с backend и имеют expiry            | TODO   |
| CDEK-003   | CDEK-002                | Создать shipment lifecycle                    | Create/cancel/label/tracking/webhook идемпотентны                 | TODO   |
| YANDEX-001 | SHIP-001                | Подключить sandbox Яндекс: адрес/ПВЗ/quote    | Quote нормализован тем же fulfillment contract                    | TODO   |
| YANDEX-002 | YANDEX-001              | Создать shipment lifecycle Яндекс             | Create/cancel/status/webhook покрыты contract tests               | TODO   |
| MOSCOW-001 | SHIP-001                | Реализовать курьера внутри МКАД               | Адрес проверяется геозоной, а не строкой `Москва`                 | TODO   |
| PICKUP-001 | STORE-002, SHIP-001     | Реализовать самовывоз                         | Доступны только магазины с sellable inventory и pickup capability | TODO   |

### Этап G. Т-Банк и онлайн-касса

Проектное решение по этапу: [`docs/design/tbank-payments-and-fiscalization.md`](docs/design/tbank-payments-and-fiscalization.md)
— контракт провайдера, схема вебхука, маппинг чека и открытые вопросы к бухгалтеру.

| ID         | Зависит от          | Микрозадача                                           | Критерий приёмки                                                         | Статус                     |
| ---------- | ------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------ | -------------------------- |
| PAY-001    | CART-004, SHIP-001  | Получить test terminal и утвердить одностадийный flow | `PayType: O`; зафиксированы Init, authorize, cancel и refund transitions | BLOCKED: нужен Т-Банк      |
| PAY-002    | PAY-001             | Реализовать Medusa T-Банк provider                    | Payment session связана с cart/payment collection/order                  | TODO                       |
| PAY-003    | PAY-002             | Проверять подпись webhook                             | Неверная подпись отклоняется; payload не логируется с secrets            | TODO                       |
| PAY-004    | PAY-003             | Обеспечить idempotency                                | Повторный webhook не создаёт второй capture/order transition             | TODO                       |
| PAY-005    | PAY-004             | Реализовать reconciliation job                        | Medusa и Т-Банк сверяются; расхождения попадают в alert/report           | TODO                       |
| FISCAL-001 | TAX-001, PAY-001    | Выбрать онлайн-кассу/OFD и ФФД                        | Зафиксированы taxation, `vat5`, payment method/object и маркировка       | BLOCKED: решение заказчика |
| FISCAL-002 | FISCAL-001, PAY-002 | Передавать receipt при платеже                        | Сумма Items, payment и Medusa total совпадает до копейки                 | TODO                       |
| FISCAL-003 | FISCAL-002          | Реализовать refund receipt                            | Полный/частичный возврат формирует корректный возвратный чек             | TODO                       |
| FISCAL-004 | FISCAL-003          | Проверить сценарий предоплата/полный расчёт           | Сценарий утверждён бухгалтером, Т-Банком и кассовым провайдером          | TODO                       |

### Этап H. Заказ, аккаунт, роли и уведомления

| ID          | Зависит от                       | Микрозадача                        | Критерий приёмки                                                         | Статус |
| ----------- | -------------------------------- | ---------------------------------- | ------------------------------------------------------------------------ | ------ |
| ORDER-001   | CDEK-002 или YANDEX-001, PAY-004 | Завершить guest checkout           | Order создаётся один раз после допустимого payment state                 | TODO   |
| ORDER-002   | ORDER-001                        | Описать order state machine        | Payment, fiscal, allocation, fulfillment и refund статусы не смешиваются | TODO   |
| NOTIFY-001  | ORDER-001                        | Подключить email provider и outbox | Transactional email отправляется один раз после commit; retry безопасен  | TODO   |
| NOTIFY-002  | NOTIFY-001                       | Добавить Telegram notifications    | Получатель и объём PII согласованы; сообщения не содержат лишние данные  | TODO   |
| AUTH-001    | NOTIFY-001                       | Реализовать customer OTP           | TTL, one-time use, attempt limit и rate limit покрыты тестами            | TODO   |
| ACCOUNT-001 | AUTH-001                         | Профиль и адреса                   | Пользователь видит и меняет только собственные данные                    | TODO   |
| ACCOUNT-002 | ACCOUNT-001, ORDER-001           | История и детали заказов           | Пользователь видит только собственные orders                             | TODO   |
| RETURN-001  | ACCOUNT-002, FISCAL-003          | Ручной return flow через Admin     | Manager создаёт возврат; refund, receipt и inventory согласованы         | TODO   |
| RETURN-002  | RETURN-001                       | Self-service return request        | Клиент выбирает позиции/причину; manager подтверждает запрос             | TODO   |
| ROLE-001    | BOOT-001                         | Утвердить role matrix              | Owner, 2 managers и 2 logisticians имеют минимально необходимые права    | TODO   |
| ROLE-002    | ROLE-001                         | Настроить Medusa RBAC              | Запрещённые операции возвращают `403`, а не только скрываются в UI       | TODO   |
| AUDIT-001   | ROLE-002                         | Добавить audit log                 | Actor/time/entity/before-after доступны для price, stock, refund и roles | TODO   |

### Этап I. Интеграция с 1С

| ID     | Зависит от             | Микрозадача                                           | Критерий приёмки                                                      | Статус                    |
| ------ | ---------------------- | ----------------------------------------------------- | --------------------------------------------------------------------- | ------------------------- |
| 1C-001 | ADR-001                | Получить владельца интеграции и обезличенные fixtures | Известны версия 1С, transport, encoding, расписание и ответственный   | BLOCKED: данные заказчика |
| 1C-002 | 1C-001, CAT-001        | Зафиксировать mapping и external IDs                  | Product/variant/SKU/store/customer/order mappings документированы     | TODO                      |
| 1C-003 | 1C-002                 | Создать inbox/outbox и sync journal                   | Каждое сообщение имеет idempotency key, status, retry и error payload | TODO                      |
| 1C-004 | 1C-003, IMPORT-001     | Импортировать catalog/prices                          | Повтор сообщения не создаёт дублей; invalid record можно переиграть   | TODO                      |
| 1C-005 | 1C-003, STORE-002      | Синхронизировать остатки по магазинам                 | Duplicate/out-of-order updates безопасны; есть discrepancy report     | TODO                      |
| 1C-006 | 1C-003, ORDER-001      | Экспортировать orders/refunds/statuses                | Один Medusa order соответствует одному order в 1С                     | TODO                      |
| 1C-007 | 1C-004, 1C-005, 1C-006 | Добавить reconciliation jobs                          | Расхождения catalog/stock/order видимы и исправляемы без SQL вручную  | TODO                      |

### Этап J. Production release gates

| ID        | Зависит от            | Микрозадача                                             | Критерий приёмки                                                        | Статус |
| --------- | --------------------- | ------------------------------------------------------- | ----------------------------------------------------------------------- | ------ |
| LEGAL-001 | —                     | Подготовить privacy, consent, offer, delivery и returns | Документы утверждены заказчиком/юристом; версии согласий сохраняются    | TODO   |
| E2E-001   | ORDER-001, FISCAL-002 | Создать основной E2E happy path                         | `ONE SIZE` → stock → delivery → T-Банк → receipt → order → notification | TODO   |
| E2E-002   | E2E-001               | Покрыть failure paths                                   | Timeout, duplicate webhook, payment fail, stock race и refund проверены | TODO   |
| LOAD-001  | E2E-001               | Провести load test на 2 CPU / 4 GB                      | Нет OOM; latency соответствует SLA; остаётся ≥20% RAM/disk headroom     | TODO   |
| SEC-005   | E2E-002               | Провести security review                                | Admin/API/auth/rate-limit/CORS/cookies/secrets проверены                | TODO   |
| DR-001    | OPS-003, CD-002       | Провести disaster recovery rehearsal                    | Backup restore и image rollback выполняются по runbook                  | TODO   |
| UAT-001   | E2E-002, LEGAL-001    | Провести UAT с заказчиком                               | Каталог, checkout, Admin, delivery, payment и returns приняты           | TODO   |
| PROD-001  | Все release gates     | Выполнить production launch                             | DNS переключён, smoke tests зелёные, monitoring активен, rollback готов | TODO   |

## 8. Основная цепочка зависимостей

```text
Security + backup + stable HTTPS
              |
              v
Reproducible bootstrap + CI/CD
              |
              v
RU tax/catalog/S3/store locations
              |
              v
Dynamic storefront + real variants
              |
              v
Medusa cart + server totals + inventory
              |
              v
Delivery quotes
              |
              v
T-Банк + fiscal receipts
              |
              v
Real order + account + notifications
              |
              v
1С + hardening + production release
```

## 9. Внешние данные, которые блокируют отдельные задачи

1. Постоянный домен и доступ к DNS.
2. Российский S3 provider, bucket и service credentials.
3. Test terminal и документация кабинета Т-Банка.
4. Выбранная онлайн-касса/OFD и подтверждённая схема чеков.
5. Sandbox credentials СДЭК и Яндекс.
6. Полный список физических магазинов и их коды.
7. Решение по маркировке «Честный ЗНАК» и источник кодов.
8. Объект УСН: «Доходы» или «Доходы минус расходы».
9. Версия/конфигурация 1С, владелец интеграции и fixtures.
10. Юридические документы и реквизиты ИП.

Продажи в СНГ не входят в первый production release. После стабильного запуска РФ для каждой страны отдельно проектируются currency, tax, payment, delivery и customs rules.

## 10. Definition of Done для каждой задачи

Задача считается завершённой, если одновременно выполнено следующее:

1. Scope задачи не расширен несвязанными изменениями.
2. Acceptance criteria выполнены и воспроизводимы.
3. Добавлены или обновлены автоматические тесты.
4. Lint, typecheck, tests и соответствующая build-команда проходят.
5. Секреты и персональные данные отсутствуют в Git и логах.
6. Для инфраструктурной задачи выполнен smoke test на staging.
7. Обновлена документация или runbook, если изменился процесс эксплуатации.
8. Есть понятный rollback или безопасный способ отменить изменение.

## 11. Следующая рабочая последовательность

Не следует сразу подключать оплату или переписывать storefront. Ближайший порядок:

1. `SEC-001`: сменить раскрытый пароль Medusa Admin.
2. `SEC-002` и `SEC-003`: сбросить раскрытый root-пароль и подтвердить key-only SSH policy.
3. `GIT-001`: оформить уже выполненный `DEV-001` отдельным commit.
4. `OPS-001`: настроить первый PostgreSQL backup.
5. `REDIS-001`: убрать local event bus и in-memory locking.
6. `OPS-004`: получить постоянный домен.
7. `OPS-005` и `OPS-006`: настроить HTTPS и убрать Quick Tunnel dependency.
8. `ADR-001`: утвердить доменные invariants до изменения seed/catalog.
9. `BOOT-001`: сделать backend воспроизводимым с пустой БД.
10. `CI-001`: привести проверки и deployment к одному управляемому pipeline.

Только после этого безопасно продолжать model/API/frontend vertical slices.
