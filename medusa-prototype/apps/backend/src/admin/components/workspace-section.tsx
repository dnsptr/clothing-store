import { Link } from "react-router-dom"
import { DocumentText } from "@medusajs/icons"
import { Badge, Container, Heading, Tabs, Text } from "@medusajs/ui"

type Section = {
  title: string
  status?: string
  tabs?: string[]
  empty?: string
  columns?: string[]
  parameters?: [string, string][]
  links?: { label: string; to: string; note: string }[]
}

export const WORKSPACE_PAGES: Record<string, Section> = {
  fulfillment: {
    title: "Оплата и доставка", status: "Единый журнал не подключён",
    tabs: ["Оплаты", "Отправления", "Требуют внимания"],
    empty: "Данные единого журнала пока не подключены",
    columns: ["Заказ", "Операция", "Служба", "Состояние"],
    parameters: [["Рабочие операции", "Доступны в карточке заказа"], ["Подключения оплаты и доставки", "Без изменений на этом этапе"]],
    links: [{ label: "Заказы", to: "/orders", note: "Платежи, фискальные возвраты и отправления в карточке заказа" }, { label: "Пункты сдачи", to: "/dispatch-points", note: "Настройка пунктов сдачи СДЭК и Яндекс по складам" }],
  },
  "media-library": {
    title: "Медиатека", status: "Общая библиотека не подключена",
    tabs: ["Фотографии товаров", "Этикетки и ярлыки", "Контент сайта"],
    empty: "Общий список медиафайлов пока не подключён",
    columns: ["Файл", "Товар / блок", "Тип", "Использование"],
    links: [{ label: "Фотографии товаров", to: "/catalog-editor", note: "Загрузка и редактирование в карточке товара" }, { label: "Изображения и видео главной", to: "/content", note: "Работа с медиа в редакторе контента" }],
  },
  assembly: {
    title: "Сборка заказов", status: "Не подключено",
    tabs: ["Ожидают сборки", "Перемещения", "Готовы к выдаче"],
    empty: "Список сборки пока не подключён",
    columns: ["Заказ", "Магазин-источник", "Позиции", "Состояние"],
    parameters: [["Место окончательной сборки", "Мосмарт"], ["Источники остатков", "Только согласованные склады 1С"]],
    links: [{ label: "Заказы", to: "/orders", note: "Текущий список заказов" }],
  },
  returns: {
    title: "Возвраты и претензии", status: "Единый журнал не подключён",
    tabs: ["Обращения", "Проверка товара", "Завершённые"],
    empty: "Журнал обращений пока не подключён",
    columns: ["Обращение", "Заказ", "Причина", "Ответственный", "Состояние"],
    parameters: [["Обратная логистика", "За счёт покупателя"], ["Возврат в продажу", "После проверки состояния ответственным сотрудником"]],
    links: [{ label: "Заказы", to: "/orders", note: "Фискальные возвраты ТБанк и история операций в карточке заказа" }],
  },
  stock: {
    title: "Остатки и резервы", status: "1С не подключена",
    tabs: ["По складам", "Резервы", "Расхождения"],
    empty: "Данные складов и резервов из 1С пока не поступают",
    columns: ["Товар / вариант", "Склад", "В наличии", "В резерве", "Доступно"],
    parameters: [["Текущий режим", "Наличие проверяется вручную"], ["Плановый резерв перед оплатой", "10 минут; автоматическое резервирование не подключено"]],
    links: [{ label: "Технический учёт остатков", to: "/inventory", note: "Данные Medusa, не подтверждённые остатки 1С" }, { label: "Технические резервы", to: "/reservations", note: "Резервы Medusa" }],
  },
  "catalog-structure": {
    title: "Категории и коллекции",
    links: [{ label: "Категории", to: "/categories", note: "Разделы каталога" }, { label: "Коллекции", to: "/collections", note: "Тематические подборки" }, { label: "Товары", to: "/catalog-editor", note: "Карточки, фотографии и варианты" }],
  },
  buyers: {
    title: "Покупатели",
    links: [{ label: "Покупатели", to: "/customers", note: "Контактные данные и история заказов" }, { label: "Группы покупателей", to: "/customer-groups", note: "Сегменты для акций" }],
  },
  discounts: {
    title: "Акции и промокоды",
    parameters: [["Базовые цены", "Розничные цены из 1С после подключения обмена"], ["Управление скидками", "В административной панели сайта"], ["Бонусы и подарочные сертификаты", "Не используются"]],
    links: [{ label: "Скидки и промокоды", to: "/promotions", note: "Условия и сроки действия" }, { label: "Кампании", to: "/campaigns", note: "Объединение акций и ограничения бюджета" }, { label: "Прайс-листы", to: "/price-lists", note: "Техническое управление ценами Medusa" }],
  },
  communications: {
    title: "Уведомления", status: "Журнал не подключён",
    tabs: ["Отправка", "Шаблоны", "Ошибки"],
    empty: "Единый журнал отправки пока не подключён",
    columns: ["Дата", "Заказ", "Получатель", "Канал", "Состояние"],
    parameters: [["События заказа", "Оплачен · Собирается · Готов к выдаче · Отправлен · Отменён"], ["Почта покупателя", "Проверка канала отправки — отдельный этап"], ["Сообщения покупателю", "Канал нужно согласовать"], ["Технические ошибки", "Электронная почта; адрес получателя нужно согласовать"]],
  },
  reports: {
    title: "Отчёты и аналитика", status: "Источники не подключены",
    tabs: ["Продажи", "Товары", "Яндекс.Метрика"],
    empty: "Данные отчётов пока не подключены",
    columns: ["Показатель", "Значение", "Источник"],
    parameters: [["Заказы, оплаты и возвраты", "Источник — бэкенд магазина"], ["Яндекс.Метрика", "Счётчик пока не настроен"], ["Посещаемость и воронка", "Источник — Яндекс.Метрика после подключения"]],
  },
  team: {
    title: "Сотрудники и доступ",
    parameters: [["Роли по рабочим задачам", "Разграничение прав требует отдельной настройки"], ["Журнал действий сотрудников", "Единый журнал не подключён"]],
    links: [{ label: "Сотрудники", to: "/settings/users", note: "Учётные записи и приглашения" }, { label: "Мой профиль", to: "/settings/profile", note: "Личные настройки" }],
  },
}

export function WorkspaceSection({ section }: { section: keyof typeof WORKSPACE_PAGES }) {
  const page = WORKSPACE_PAGES[section]
  return <Container className="p-0">
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-ui-border-base px-6 py-5">
      <Heading level="h1">{page.title}</Heading>
      {page.status && <Badge color="grey">{page.status}</Badge>}
    </header>
    {page.links && <div className="divide-y divide-ui-border-base px-6">
      {page.links.map(link => <Link key={link.to} to={link.to} className="flex flex-wrap items-center justify-between gap-2 py-4 text-ui-fg-base hover:text-ui-fg-interactive">
        <span className="text-sm font-medium">{link.label} <span aria-hidden="true">→</span></span>
        <Text size="small" className="text-ui-fg-subtle">{link.note}</Text>
      </Link>)}
    </div>}
    {page.tabs && <Tabs defaultValue="0">
      <div className="overflow-x-auto border-b border-ui-border-base px-6 py-3">
        <Tabs.List aria-label={page.title} className="min-w-max">
          {page.tabs.map((label, index) => <Tabs.Trigger key={label} value={String(index)}>{label}</Tabs.Trigger>)}
        </Tabs.List>
      </div>
      {page.tabs.map((label, index) => <Tabs.Content key={label} value={String(index)}>
        <div className="overflow-x-auto"><table className="w-full min-w-[540px] text-left text-sm"><caption className="sr-only">{label}</caption>
          <thead className="border-b border-ui-border-base text-ui-fg-subtle"><tr>{(index === 0 ? page.columns : ["Запись", "Состояние"])?.map(column => <th key={column} className="px-6 py-3 font-medium">{column}</th>)}</tr></thead>
          <tbody />
        </table></div>
        <div role="status" className="px-6 py-14 text-center text-ui-fg-subtle"><DocumentText className="mx-auto mb-3" /><p className="break-words text-sm">{page.empty}</p></div>
      </Tabs.Content>)}
    </Tabs>}
    {page.parameters && <dl className="divide-y divide-ui-border-base border-t border-ui-border-base px-6">
      {page.parameters.map(([label, value]) => <div key={label} className="grid gap-2 py-4 text-sm md:grid-cols-[220px_1fr]"><dt className="text-ui-fg-subtle">{label}</dt><dd className="min-w-0 break-words">{value}</dd></div>)}
    </dl>}
  </Container>
}
