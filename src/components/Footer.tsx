"use client";

import { useState } from "react";
import Link from "next/link";
import { useBodyScrollLock } from "@/hooks/useBodyScrollLock";
import { useOverlayDismiss } from "@/hooks/useOverlayDismiss";
import styles from "./Footer.module.css";

// Страницы «Отзывы» и «Реферальная программа» убраны вместе со ссылками:
// отзывов на сайте оставить негде, а реферальная программа обещала
// персональную ссылку в личном кабинете, которого нет.
const footerColumns = [
  {
    title: "Покупателям",
    links: [
      { label: "Доставка", href: "/info/delivery" },
      { label: "Возврат", href: "/info/returns" },
      { label: "Вопросы и ответы", href: "/info/faq" },
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

// Юридические документы продавца. Их ищут в подвале — и покупатель, и банк при
// модерации сайта для эквайринга, — поэтому они вынесены отдельной строкой,
// видимой на каждой странице.
const legalLinks = [
  { label: "Публичная оферта", href: "/info/offer" },
  { label: "Обработка персональных данных", href: "/info/privacy" },
  { label: "Условия возврата", href: "/info/returns" },
  { label: "Реквизиты продавца", href: "/info/requisites" },
];

export default function Footer() {
  const [isSubscribeModalOpen, setIsSubscribeModalOpen] = useState(false);

  const closeSubscribeModal = () => setIsSubscribeModalOpen(false);

  useBodyScrollLock(isSubscribeModalOpen);
  useOverlayDismiss(isSubscribeModalOpen, closeSubscribeModal);

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
                onClick={() => setIsSubscribeModalOpen(true)}
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

        <nav className={styles.legal} aria-label="Правовая информация">
          {legalLinks.map((link) => (
            <Link key={link.href} href={link.href} className={styles.legalLink}>
              {link.label}
            </Link>
          ))}
        </nav>

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

            {/* Форма подписки убрана до появления рассылки.
                Она показывала «Спасибо за подписку» и «Мы добавили <email> в
                список рассылки», не сделав ни одного сетевого запроса: адрес
                никуда не сохранялся, а согласие на рекламную рассылку при этом
                фиксировалось. Собирать e-mail, которому некуда деться, нельзя
                ни с точки зрения покупателя, ни с точки зрения 152-ФЗ. */}
            <div className={styles.subscribeSuccess}>
              <h2 id="subscribe-modal-title" className={styles.modalTitle}>
                Рассылка ещё готовится
              </h2>
              <p className={styles.modalSuccessText}>
                Мы настраиваем письма о новинках и специальных предложениях.
                Подписка появится здесь, как только мы её запустим.
              </p>
              <button type="button" className={styles.modalSubmitBtn} onClick={closeSubscribeModal}>
                Понятно
              </button>
            </div>
          </section>
        </div>
      )}
    </footer>
  );
}
