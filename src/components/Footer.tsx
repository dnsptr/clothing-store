"use client";

import Link from "next/link";
import styles from "./Footer.module.css";

export default function Footer() {
  return (
    <footer className={styles.footer}>
      <div className="container">
        <div className={styles.top}>
          {/* Subscribe Block */}
          <div className={styles.subscribeSection}>
            <h3 className={styles.subscribeTitle}>Подписка на новости</h3>
            <p className={styles.subscribeText}>
              Получайте информацию о новых коллекциях, закрытых распродажах и специальных предложениях.
            </p>
            <form className={styles.subscribeForm} onSubmit={(e) => e.preventDefault()}>
              <input
                type="email"
                placeholder="Ваш e-mail"
                className={styles.input}
                required
              />
              <button type="submit" className={styles.submitBtn} aria-label="Подписаться">
                <svg
                  className={styles.submitIcon}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="1.5"
                    d="M14 5l7 7m0 0l-7 7m7-7H3"
                  />
                </svg>
              </button>
            </form>
          </div>

          {/* Links Block 1 */}
          <div className={styles.column}>
            <h4 className={styles.colTitle}>Покупателям</h4>
            <ul className={styles.links}>
              <li>
                <Link href="#" className={styles.link}>
                  Доставка и оплата
                </Link>
              </li>
              <li>
                <Link href="#" className={styles.link}>
                  Возврат и обмен
                </Link>
              </li>
              <li>
                <Link href="#" className={styles.link}>
                  Таблица размеров
                </Link>
              </li>
              <li>
                <Link href="#" className={styles.link}>
                  Частые вопросы (FAQ)
                </Link>
              </li>
            </ul>
          </div>

          {/* Links Block 2 */}
          <div className={styles.column}>
            <h4 className={styles.colTitle}>О компании</h4>
            <ul className={styles.links}>
              <li>
                <Link href="#" className={styles.link}>
                  История бренда
                </Link>
              </li>
              <li>
                <Link href="#" className={styles.link}>
                  Магазины
                </Link>
              </li>
              <li>
                <Link href="#" className={styles.link}>
                  Карьера
                </Link>
              </li>
              <li>
                <Link href="#" className={styles.link}>
                  Контакты
                </Link>
              </li>
            </ul>
          </div>

          {/* Links Block 3 */}
          <div className={styles.column}>
            <h4 className={styles.colTitle}>Сервис</h4>
            <ul className={styles.links}>
              <li>
                <Link href="#" className={styles.link}>
                  Подарочные карты
                </Link>
              </li>
              <li>
                <Link href="#" className={styles.link}>
                  Программа лояльности
                </Link>
              </li>
              <li>
                <Link href="#" className={styles.link}>
                  Уход за вещами
                </Link>
              </li>
              <li>
                <Link href="#" className={styles.link}>
                  Обратная связь
                </Link>
              </li>
            </ul>
          </div>
        </div>

        {/* Bottom Block */}
        <div className={styles.bottom}>
          <div className={styles.copy}>
            &copy; {new Date().getFullYear()} MINIMALIST. Все права защищены.
          </div>
          <div className={styles.socials}>
            <Link href="#" className={styles.socialLink}>
              Telegram
            </Link>
            <Link href="#" className={styles.socialLink}>
              VKontakte
            </Link>
            <Link href="#" className={styles.socialLink}>
              Pinterest
            </Link>
            <Link href="#" className={styles.socialLink}>
              Youtube
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
