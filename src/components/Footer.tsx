"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import styles from "./Footer.module.css";

const footerColumns = [
  {
    title: "Покупателям",
    links: [
      { label: "Доставка", href: "/info/delivery" },
      { label: "Возврат", href: "/info/returns" },
      { label: "Вопросы и ответы", href: "/info/faq" },
      { label: "Отзывы", href: "/info/reviews" },
      { label: "Шопинг-сессия", href: "/info/shopping-session" },
      { label: "Партнерская программа", href: "/info/affiliate" },
      { label: "Программа лояльности", href: "/info/loyalty" },
      { label: "Для бизнеса", href: "/info/business" },
    ],
  },
  {
    title: "О компании",
    links: [
      { label: "Истории", href: "/info/stories" },
      { label: "Карьера", href: "/info/careers" },
      { label: "Контакты", href: "/info/contacts" },
      { label: "Устойчивое развитие", href: "/info/sustainability" },
    ],
  },
];

export default function Footer() {
  const [isSubscribeFormVisible, setIsSubscribeFormVisible] = useState(false);
  const [email, setEmail] = useState("");
  const [isSubscribed, setIsSubscribed] = useState(false);

  const handleSubscribe = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!email.trim()) return;

    setIsSubscribed(true);
  };

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

          <div className={styles.subscribeSection}>
            {isSubscribed ? (
              <div className={styles.subscribePrompt}>
                <p className={styles.subscribeText}>
                  Спасибо. Мы добавили {email} в список рассылки.
                </p>
                <button
                  type="button"
                  className={styles.submitBtn}
                  onClick={() => {
                    setEmail("");
                    setIsSubscribed(false);
                    setIsSubscribeFormVisible(false);
                  }}
                >
                  Готово
                </button>
              </div>
            ) : isSubscribeFormVisible ? (
              <>
                <p className={styles.subscribeText}>
                  Подпишитесь на рассылку, чтобы первыми узнавать о новых коллекциях, специальных предложениях и сервисах.
                </p>
                <form className={styles.subscribeForm} onSubmit={handleSubscribe}>
                  <input
                    type="email"
                    placeholder="Ваш e-mail"
                    className={styles.input}
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    required
                  />
                  <button type="submit" className={styles.submitBtn}>
                    Подписаться на рассылку
                  </button>
                </form>
              </>
            ) : (
              <div className={styles.subscribePrompt}>
                <p className={styles.subscribeText}>
                  Давайте дружить по переписке. Будем рассказывать вам о новинках и специальных предложениях. Хотите?
                </p>
                <button
                  type="button"
                  className={styles.submitBtn}
                  onClick={() => setIsSubscribeFormVisible(true)}
                >
                  Хочу
                </button>
              </div>
            )}
            <div className={styles.socials}>
              <Link href="https://www.youtube.com/" className={styles.socialLink}>
                YouTube
              </Link>
              <Link href="https://vk.com/" className={styles.socialLink}>
                ВКонтакте
              </Link>
              <Link href="https://t.me/" className={styles.socialLink}>
                Telegram
              </Link>
            </div>
          </div>
        </div>

        <div className={styles.bottom}>
          <Link href="/info/english" className={styles.locale}>
            English version
          </Link>
          <div className={styles.copy}>MARIO MIKKE, {new Date().getFullYear()}</div>
        </div>
      </div>
    </footer>
  );
}
