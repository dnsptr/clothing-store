// Medusa's language detector runs after loading extension resources.
// This store has a Russian-only staff interface, including on first login.
if (typeof window !== "undefined") {
  try { window.localStorage.setItem("lng", "ru") } catch { /* Storage may be disabled. */ }
  document.cookie = "lng=ru;path=/;SameSite=Lax"
  document.documentElement.lang = "ru"
}

export default {
  ru: {
    translation: {
      app: { nav: { settings: { header: "Настройки" } } },
      orders: { domain: "Заказы" },
      products: { domain: "Товары" },
      collections: { domain: "Коллекции" },
      categories: { domain: "Категории" },
      customers: { domain: "Покупатели" },
      promotions: { domain: "Акции и промокоды" },
      users: { domain: "Сотрудники" },
    },
  },
}