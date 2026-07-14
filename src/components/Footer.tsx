"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { useBodyScrollLock } from "@/hooks/useBodyScrollLock";
import { useOverlayDismiss } from "@/hooks/useOverlayDismiss";
import styles from "./Footer.module.css";

const footerColumns = [
  {
    title: "Покупателям",
    links: [
      { label: "Доставка", href: "/info/delivery" },
      { label: "Возврат", href: "/info/returns" },
      { label: "Вопросы и ответы", href: "/info/faq" },
      { label: "Отзывы", href: "/info/reviews" },
      { label: "Реферальная программа", href: "/info/referral" },
      { label: "Личный кабинет", href: "/account" },
    ],
  },
  {
    title: "О компании",
    links: [
      { label: "О бренде", href: "/info/about" },
      { label: "Магазины и контакты", href: "/info/contacts" },
      { label: "Истории", href: "/info/stories" },
      { label: "Устойчивое развитие", href: "/info/sustainability" },
    ],
  },
];

export default function Footer() {
  const [isSubscribeModalOpen, setIsSubscribeModalOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [isSubscribed, setIsSubscribed] = useState(false);
  const isEmailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  const closeSubscribeModal = () => setIsSubscribeModalOpen(false);

  useBodyScrollLock(isSubscribeModalOpen);
  useOverlayDismiss(isSubscribeModalOpen, closeSubscribeModal);

  const handleSubscribe = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!isEmailValid) return;

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
            <div className={styles.subscribePrompt}>
              <p className={styles.subscribeText}>
                Давайте дружить по переписке. Будем рассказывать вам о новинках и специальных предложениях. Хотите?
              </p>
              <button
                type="button"
                className={styles.submitBtn}
                onClick={() => {
                  setIsSubscribed(false);
                  setIsSubscribeModalOpen(true);
                }}
              >
                Хочу
              </button>
            </div>
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

      {isSubscribeModalOpen && (
        <div
          className={styles.subscribeOverlay}
          onClick={(event) => {
            if (event.target === event.currentTarget) closeSubscribeModal();
          }}
        >
          <section
            className={styles.subscribeModal}
            role="dialog"
            aria-modal="true"
            aria-labelledby="subscribe-modal-title"
          >
            <button
              type="button"
              className={styles.closeButton}
              onClick={closeSubscribeModal}
              aria-label="Закрыть"
            >
              <span aria-hidden="true" />
            </button>

            {isSubscribed ? (
              <div className={styles.subscribeSuccess}>
                <h2 id="subscribe-modal-title" className={styles.modalTitle}>
                  Спасибо за подписку
                </h2>
                <p className={styles.modalSuccessText}>Мы добавили {email} в список рассылки.</p>
                <button type="button" className={styles.modalSubmitBtn} onClick={closeSubscribeModal}>
                  Готово
                </button>
              </div>
            ) : (
              <>
                <h2 id="subscribe-modal-title" className={styles.modalTitle}>
                  Подписка на рассылку
                </h2>
                <form className={styles.modalForm} onSubmit={handleSubscribe}>
                  <label className={styles.visuallyHidden} htmlFor="subscribe-email">
                    Эл. почта
                  </label>
                  <input
                    id="subscribe-email"
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    placeholder="Эл. почта"
                    className={styles.modalInput}
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    required
                  />
                  <button type="submit" className={styles.modalSubmitBtn} disabled={!isEmailValid}>
                    Подписаться
                  </button>
                  <p className={styles.legalText}>
                    Нажимая на кнопку «Подписаться», вы подтверждаете, что ознакомились с{" "}
                    <Link href="/info/privacy">политикой конфиденциальности</Link>, и даете согласие на получение
                    рассылки, в том числе рекламной.
                  </p>
                </form>
              </>
            )}
          </section>
        </div>
      )}
    </footer>
  );
}
