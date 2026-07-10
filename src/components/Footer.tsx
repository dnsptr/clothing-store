"use client";

import { useState } from "react";
import Link from "next/link";
import styles from "./Footer.module.css";

const footerColumns = [
  {
    title: "Покупателям",
    links: [
      "Доставка",
      "Возврат",
      "Вопросы и ответы",
      "Отзывы",
      "Шопинг-сессия",
      "Партнерская программа",
      "Программа лояльности",
      "Для бизнеса",
    ],
  },
  {
    title: "О компании",
    links: ["Истории", "Карьера", "Контакты", "Устойчивое развитие"],
  },
];

export default function Footer() {
  const [isSubscribeFormVisible, setIsSubscribeFormVisible] = useState(false);

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
                    <li key={link}>
                      <Link href="#" className={styles.link}>
                        {link}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>

          <div className={styles.subscribeSection}>
            {isSubscribeFormVisible ? (
              <>
                <p className={styles.subscribeText}>
                  Подпишитесь на рассылку, чтобы первыми узнавать о новых коллекциях, специальных предложениях и сервисах.
                </p>
                <form className={styles.subscribeForm} onSubmit={(e) => e.preventDefault()}>
                  <input type="email" placeholder="Ваш e-mail" className={styles.input} required />
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
              <Link href="#" className={styles.socialLink}>
                YouTube
              </Link>
              <Link href="#" className={styles.socialLink}>
                ВКонтакте
              </Link>
              <Link href="#" className={styles.socialLink}>
                Telegram
              </Link>
            </div>
          </div>
        </div>

        <div className={styles.bottom}>
          <Link href="#" className={styles.locale}>
            English version
          </Link>
          <div className={styles.copy}>12 STOREEZ, {new Date().getFullYear()}</div>
        </div>
      </div>
    </footer>
  );
}
