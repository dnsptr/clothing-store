import React from "react";
import styles from "./PaymentLogos.module.css";

interface PaymentLogosProps {
  showSecurityText?: boolean;
  className?: string;
}

export default function PaymentLogos({ showSecurityText = true, className }: PaymentLogosProps) {
  return (
    <div className={`${styles.container}${className ? ` ${className}` : ""}`}>
      <div className={styles.badges} role="group" aria-label="Принимаемые способы оплаты">
        {/* МИР */}
        <span className={styles.badge} title="Платёжная система МИР">
          <svg
            className={styles.icon}
            viewBox="0 0 64 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            role="img"
            aria-label="МИР"
          >
            <rect width="64" height="24" rx="3" fill="#0B5C9E" />
            <path
              d="M11 7h3.8l3.1 5.4L21 7h3.8v10h-3.4v-5.6l-3.5 5.6h-2.1L12.3 11.4V17H11V7zm17.2 0H31v10h-2.8V7zm14.6 0H35v10h2.8v-3.7h5c2.6 0 4.4-1.4 4.4-3.2 0-1.7-1.8-3.1-4.4-3.1zm-.4 3.7h-4.6V9.4h4.6c1.2 0 2 .5 2 1.3 0 .8-.8 1.4-2 1.4zm10.7-3.7h-3.3v10h2.8v-3.8h.5l3.1 3.8h3.6l-3.5-4.2c1.7-.5 2.7-1.7 2.7-2.9 0-1.8-1.7-2.9-4.2-2.9zm-.5 3.6h-1.8V9.4h1.8c1.1 0 1.9.4 1.9 1.2 0 .8-.8 1.3-1.9 1.3z"
              fill="#FFFFFF"
            />
            <path
              d="M37.8 7H45c2.6 0 4.4 1.4 4.4 3.1 0 1.8-1.8 3.2-4.4 3.2h-5V7z"
              fill="#00B4E6"
            />
          </svg>
        </span>

        {/* СБП */}
        <span className={styles.badge} title="Система быстрых платежей (СБП)">
          <svg
            className={styles.icon}
            viewBox="0 0 64 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            role="img"
            aria-label="СБП"
          >
            <rect width="64" height="24" rx="3" fill="#FFFFFF" stroke="#E2DFD9" strokeWidth="1" />
            <path d="M14 6l4.5 4.5h-5.2L11 8.2z" fill="#0077C8" />
            <path d="M18.5 10.5l-4.5 4.5v-5.2l2.3-2.3z" fill="#F8B133" />
            <path d="M14 15l-4.5-4.5h5.2l2.3 2.3z" fill="#78BE20" />
            <path
              d="M26.2 15.2c-.8.5-1.8.8-2.9.8-2.4 0-4-1.5-4-3.9 0-2.3 1.7-4 4.1-4 1.1 0 2 .3 2.7.8l-.8 1.7c-.5-.4-1.2-.6-1.9-.6-1.3 0-2.2.9-2.2 2.1 0 1.2.9 2.1 2.2 2.1.7 0 1.4-.2 1.9-.6l.9 1.6zm4.1.8h-2.1V8.2h4.5c1.8 0 2.9.9 2.9 2.3 0 1-.6 1.7-1.5 2 1 .3 1.7 1.1 1.7 2.2 0 1.4-1.2 2.3-3.1 2.3h-2.4v-1zm1.9-3.7c.6 0 1-.4 1-1 0-.6-.4-1-1-1h-1.9v2h1.9zm.3 2.8c.7 0 1.1-.4 1.1-1.1s-.4-1.1-1.1-1.1h-2.2v2.2h2.2zm7.2-5.9h-2.1v7.8h2.1v-2.8h2.6c1.9 0 3.2-1.1 3.2-2.5s-1.3-2.5-3.2-2.5zm.5 3.3v-1.6h2.4c.7 0 1.2.3 1.2.8s-.5.8-1.2.8h-2.4z"
              fill="#1D1D1B"
            />
          </svg>
        </span>

        {/* Т-Банк */}
        <span className={styles.badge} title="Т-Банк">
          <svg
            className={styles.icon}
            viewBox="0 0 68 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            role="img"
            aria-label="Т-Банк"
          >
            <rect width="68" height="24" rx="3" fill="#FFDD2D" />
            <path
              d="M14 6c3.5 0 6.5-1.5 6.5-1.5v6c0 4.5-6.5 7.5-6.5 7.5S7.5 15 7.5 10.5v-6S10.5 6 14 6z"
              fill="#000000"
            />
            <path d="M10.8 8.2h6.4v1.8h-2.1v4.8h-2.2V10H10.8V8.2z" fill="#FFFFFF" />
            <path
              d="M26 8.5h6v1.8h-1.9v6.2h-2.2v-6.2H26V8.5zm7.2 4.2h3v1.6h-3v-1.6zm5.8-4.2h2.2v7h3.6v1.8h-5.8V8.5zm11 0h2.4l3.1 8.8h-2.3l-.6-1.8h-2.7l-.6 1.8h-2.3l3-8.8zm2.2 5.3l-.9-2.7-.9 2.7h1.8zm5.7-5.3h2.2l3 4.8V8.5h2.1v8.8h-2.2l-3-4.8v4.8H57.9V8.5zm9.8 0h2.2v3.6l2.8-3.6h2.7l-3.3 4.1 3.6 4.7H73l-2.9-3.9v3.9h-2.2V8.5z"
              fill="#000000"
            />
          </svg>
        </span>

        {/* Mastercard */}
        <span className={styles.badge} title="Mastercard">
          <svg
            className={styles.icon}
            viewBox="0 0 48 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            role="img"
            aria-label="Mastercard"
          >
            <rect width="48" height="24" rx="3" fill="#FFFFFF" stroke="#E2DFD9" strokeWidth="1" />
            <circle cx="19" cy="12" r="7" fill="#EB001B" />
            <circle cx="29" cy="12" r="7" fill="#F79E1B" />
            <path
              d="M24 6.7a7 7 0 0 1 2 5.3 7 7 0 0 1-2 5.3 7 7 0 0 1-2-5.3 7 7 0 0 1 2-5.3z"
              fill="#FF5F00"
            />
          </svg>
        </span>

        {/* Visa */}
        <span className={styles.badge} title="Visa">
          <svg
            className={styles.icon}
            viewBox="0 0 48 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            role="img"
            aria-label="Visa"
          >
            <rect width="48" height="24" rx="3" fill="#FFFFFF" stroke="#E2DFD9" strokeWidth="1" />
            <path
              d="M16.8 16.5l2.6-10.2h2.7l-2.6 10.2h-2.7zm9.4-10c-.5-.2-1.3-.4-2.4-.4-2.6 0-4.5 1.3-4.5 3.2 0 1.4 1.3 2.2 2.3 2.7 1 .5 1.4.8 1.4 1.3 0 .7-.9 1-1.7 1-.9 0-1.6-.2-2.3-.5l-.4 1.8c.6.3 1.6.5 2.6.5 2.7 0 4.6-1.3 4.6-3.3 0-1.1-.7-2-2.2-2.7-.9-.5-1.5-.8-1.5-1.3 0-.4.5-.9 1.5-.9.9 0 1.5.2 2 .4l.6-1.8zm7.8 6.5c.2-.5.9-2.3.9-2.3s-.2.4-.4.8l-1.3 5h-2.4l3.6-10.2h2.8l2.2 10.2h-2.6l-.8-2.5h-2.6zm-17.6-6.5l-3.3 7.3-.4-1.7c-.6-2.1-2.4-4.4-4.4-5.4l1.9 8.2h2.8l4.2-10.2h-2.8z"
              fill="#1A1F71"
            />
          </svg>
        </span>
      </div>

      {showSecurityText && (
        <div className={styles.securityInfo}>
          <svg
            className={styles.lockIcon}
            viewBox="0 0 14 16"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden="true"
          >
            <path
              d="M11.5 6.5V4.75a4.5 4.5 0 0 0-9 0V6.5A1.5 1.5 0 0 0 1 8v6a1.5 1.5 0 0 0 1.5 1.5h9A1.5 1.5 0 0 0 13 14V8a1.5 1.5 0 0 0-1.5-1.5zm-7-1.75a2.5 2.5 0 0 1 5 0V6.5h-5V4.75zm4 7.25H5.5v-2h2v2z"
              fill="currentColor"
            />
          </svg>
          <span className={styles.securityText}>
            Оплата картами защищена технологией 3D-Secure и протоколом шифрования TLS. Обработка платежей осуществляется процессинговым центром Т-Банка.
          </span>
        </div>
      )}
    </div>
  );
}
