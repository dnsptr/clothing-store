import Link from "next/link";
import styles from "./Footer.module.css";

// Страницы «Отзывы» и «Реферальная программа» убраны вместе со ссылками:
// отзывов на сайте оставить негде, а реферальная программа обещала
// персональную ссылку в личном кабинете, которого нет.
const footerColumns = [
  {
    title: "Покупателям",
    links: [
      { label: "Доставка и оплата", href: "/info/delivery" },
      { label: "Возврат и претензии", href: "/info/returns" },
      { label: "Вопросы и ответы", href: "/info/faq" },
      { label: "Личный кабинет", href: "/account" },
    ],
  },
  {
    title: "О компании",
    links: [
      { label: "О бренде", href: "/info/about" },
      { label: "Магазины и контакты", href: "/info/contacts" },
    ],
  },
];

// Юридические документы продавца. Их ищут в подвале — и покупатель, и банк при
// модерации сайта для эквайринга, — поэтому они вынесены отдельной строкой,
// видимой на каждой странице.
const legalLinks = [
  { label: "Публичная оферта", href: "/info/offer" },
  { label: "Политика обработки персональных данных", href: "/info/privacy" },
  { label: "Согласие на обработку ПДн", href: "/info/consent" },
  { label: "Доставка и оплата", href: "/info/delivery" },
  { label: "Возврат и претензии", href: "/info/returns" },
  { label: "Политика Cookie", href: "/info/cookies" },
  { label: "Реквизиты и контакты", href: "/info/requisites" },
];

export default function Footer() {
  return (
    <footer className={styles.footer}>
      <div className={styles.inner}>
        <div className={styles.top}>
          <nav className={styles.nav} aria-label="Ссылки в подвале">
            {footerColumns.map((column) => (
              <div className={styles.column} key={column.title}>
                <h4 className={styles.colTitle}>{column.title}</h4>
                <ul className={styles.links}>
                  {column.links.map((link) => (
                    <li key={link.href}>
                      <Link href={link.href} className={styles.link}>
                        {link.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>

          <div className={styles.contactSection}>
            <h4 className={styles.colTitle}>Связаться с нами</h4>
            <p className={styles.contactText}>
              Поможем с вопросами о заказе, доставке и возврате.
            </p>
            <a className={styles.link} href="tel:+79260577205">
              +7 (926) 057-72-05
            </a>
            <a className={styles.link} href="mailto:rauf.zamanov@mail.ru">
              rauf.zamanov@mail.ru
            </a>
          </div>
        </div>

        <nav className={styles.legal} aria-label="Правовая информация">
          {legalLinks.map((link) => (
            <Link key={link.href} href={link.href} className={styles.legalLink}>
              {link.label}
            </Link>
          ))}
        </nav>

        <div className={styles.bottom}>
          <div className={styles.copy}>MARIO MIKKE, {new Date().getFullYear()}</div>
        </div>
      </div>

    </footer>
  );
}
