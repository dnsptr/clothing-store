import { INFO_PAGES } from "./infoPages";
import type { SiteContent } from "./site-content-contract";

export const DEFAULT_SITE_CONTENT: SiteContent = {
  footer: {
    columns: [
      { title: "Покупателям", links: [{ label: "Доставка и оплата", href: "/info/delivery" }, { label: "Возврат и претензии", href: "/info/returns" }, { label: "Вопросы и ответы", href: "/info/faq" }, { label: "Личный кабинет", href: "/account" }] },
      { title: "О компании", links: [{ label: "О бренде", href: "/info/about" }, { label: "Магазины и контакты", href: "/info/contacts" }] },
    ],
    legalLinks: [
      { label: "Публичная оферта", href: "/info/offer" },
      { label: "Политика обработки персональных данных", href: "/info/privacy" },
      { label: "Согласие на обработку ПДн", href: "/info/consent" },
      { label: "Доставка и оплата", href: "/info/delivery" },
      { label: "Возврат и претензии", href: "/info/returns" },
      { label: "Политика Cookie", href: "/info/cookies" },
      { label: "Реквизиты и контакты", href: "/info/requisites" },
    ],
    contactTitle: "Связаться с нами", contactText: "Поможем с вопросами о заказе, доставке и возврате.",
    phone: "+7 (926) 057-72-05", phoneHref: "+79260577205", email: "rauf.zamanov@mail.ru", copyright: "MARIO MIKKE",
  },
  pages: INFO_PAGES,
};
