export const ADMIN_SECTIONS = [
  { path: "/workspace", label: "Обзор", state: "available" },
  { path: "/orders", label: "Заказы", state: "available" },
  { path: "/fulfillment", label: "Оплата и доставка", state: "planned" },
  { path: "/dispatch-points", label: "Пункты сдачи", state: "available" },
  { path: "/assembly", label: "Сборка заказов", state: "planned" },
  { path: "/returns", label: "Возвраты и претензии", state: "planned" },
  { path: "/catalog-editor", label: "Товары", state: "available" },
  { path: "/media-library", label: "Медиатека", state: "planned" },
  { path: "/catalog-structure", label: "Категории и коллекции", state: "available" },
  { path: "/stock", label: "Остатки и резервы", state: "planned" },
  { path: "/buyers", label: "Покупатели", state: "available" },
  { path: "/discounts", label: "Акции и промокоды", state: "available" },
  { path: "/content", label: "Контент сайта", state: "available" },
  { path: "/communications", label: "Уведомления", state: "planned" },
  { path: "/reports", label: "Отчёты и аналитика", state: "planned" },
  { path: "/team", label: "Сотрудники и доступ", state: "available" },
  { path: "/integrations", label: "Интеграции и обмен", state: "available" },
] as const

export function storeSidebarConfiguration() {
  const widgets: Record<string, { hidden?: boolean; order?: number }> = {
    "core:Searchbar": { order: -1 },
    "core:Divider": { hidden: true },
  }
  for (const path of ["/products", "/inventory", "/customers", "/promotions", "/price-lists"]) {
    widgets[`core:nav:${path}`] = { hidden: true }
  }
  ADMIN_SECTIONS.forEach(({ path }, order) => {
    widgets[`core:nav:${path}`] = { hidden: false, order }
  })
  return { widgets }
}
