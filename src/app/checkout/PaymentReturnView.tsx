import type { ReactNode } from "react";
import Link from "next/link";
import styles from "./checkout.module.css";
import type { PaymentReturnState } from "./paymentReturnState";

type ReturnIconKind = "success" | "failed" | "delayed" | "unverified";

function ReturnIcon({ kind }: { readonly kind: ReturnIconKind }) {
  const iconClassName = kind === "success"
    ? styles.returnIconSuccess
    : kind === "failed"
      ? styles.returnIconFailed
      : styles.returnIconNeutral;

  if (kind === "success") {
    return (
      <div className={`${styles.returnIcon} ${iconClassName}`} aria-hidden="true">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
    );
  }

  if (kind === "failed") {
    return (
      <div className={`${styles.returnIcon} ${iconClassName}`} aria-hidden="true">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
    );
  }

  return (
    <div className={`${styles.returnIcon} ${iconClassName}`} aria-hidden="true">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="10" />
        <path
          d={kind === "delayed" ? "M12 6v6l4 2" : "M12 16v-4M12 8h.01"}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}

function ReturnActions({ children }: { readonly children: ReactNode }) {
  return <div className={styles.returnActions}>{children}</div>;
}

function contentFor(state: PaymentReturnState): ReactNode {
  switch (state.kind) {
    case "verifying":
      return (
        <>
          <div className={styles.returnSpinner} aria-hidden="true" />
          <h2 className={styles.returnTitle}>Проверяем статус оплаты...</h2>
          <p className={styles.returnText}>
            Пожалуйста, не закрывайте страницу. Мы получаем официальное подтверждение от платёжной системы.
          </p>
        </>
      );
    case "order_processing":
      return (
        <>
          <div className={styles.returnSpinner} aria-hidden="true" />
          <h2 className={styles.returnTitle}>Оплата подтверждена, формируем заказ...</h2>
          <p className={styles.returnText}>
            Платёж успешно принят. Завершаем регистрацию заказа и готовим подтверждение.
          </p>
        </>
      );
    case "success":
      return (
        <>
          <ReturnIcon kind="success" />
          <h2 className={styles.returnTitle}>Оплата прошла успешно! Заказ оформлен.</h2>
          <p className={styles.returnText}>
            Спасибо за покупку! Детали вашего заказа и электронный чек отправлены на вашу почту.
          </p>
          <ReturnActions>
            <Link href="/catalog" className={styles.submitBtn}>Продолжить покупки</Link>
          </ReturnActions>
        </>
      );
    case "failed":
      return (
        <>
          <ReturnIcon kind="failed" />
          <h2 className={styles.returnTitle}>Оплата не была завершена или была отменена</h2>
          <p className={styles.returnText}>
            Средства не были списаны. Все выбранные товары сохранены в вашей корзине, вы можете попробовать снова.
          </p>
          <ReturnActions>
            <Link href="/checkout" className={styles.submitBtn}>Вернуться к оформлению</Link>
          </ReturnActions>
        </>
      );
    case "timeout":
      return (
        <>
          <ReturnIcon kind="failed" />
          <h2 className={styles.returnTitle}>Оплата не была завершена или была отменена</h2>
          <p className={styles.returnText}>
            Время ожидания ответа от платёжной системы истекло. Товары сохранены в вашей корзине.
          </p>
          <ReturnActions>
            <Link href="/checkout" className={styles.submitBtn}>Вернуться к оформлению</Link>
          </ReturnActions>
        </>
      );
    case "order_delayed":
      return (
        <>
          <ReturnIcon kind="delayed" />
          <h2 className={styles.returnTitle}>Оплата принята, заказ формируется</h2>
          <p className={styles.returnText}>
            Платёж успешно получен банком. Регистрация заказа в системе занимает чуть больше времени, чем обычно. Пожалуйста, не переживайте: средства уже списаны, подтверждение и детали заказа поступят на вашу электронную почту.
          </p>
          <ReturnActions>
            <Link href="/catalog" className={styles.submitBtn}>Перейти в каталог</Link>
          </ReturnActions>
        </>
      );
    case "unverified":
      return (
        <>
          <ReturnIcon kind="unverified" />
          <h2 className={styles.returnTitle}>Статус платежа не подтверждён</h2>
          <p className={styles.returnText}>
            Не удалось проверить статус оплаты. Если средства были списаны, заказ будет обработан автоматически.
          </p>
          <ReturnActions>
            <Link href="/checkout" className={styles.submitBtn}>Вернуться к оформлению</Link>
            <Link href="/catalog" className={styles.returnButtonSecondary}>Перейти в каталог</Link>
          </ReturnActions>
        </>
      );
  }
}

export function PaymentReturnView({ state }: { readonly state: PaymentReturnState }) {
  return (
    <div className={styles.returnContainer} role="status" aria-live="polite">
      {contentFor(state)}
    </div>
  );
}
