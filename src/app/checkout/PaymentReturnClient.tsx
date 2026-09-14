"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useCart, getStoredCartId } from "@/context/CartContext";
import { getMedusaPaymentStatus, type MedusaPaymentStatus } from "@/lib/medusa";
import styles from "./checkout.module.css";

const CART_CAPABILITY_REGEX = /^cart_[0-9A-HJKMNP-TV-Z]{26}$/;

const DEFAULT_POLL_INTERVAL_MS = 2000;
const DEFAULT_MAX_POLL_ATTEMPTS = 15;

function getPollInterval(): number {
  if (typeof window !== "undefined") {
    const windowCustom = Number(
      (window as unknown as { __PAYMENT_POLL_INTERVAL_MS?: unknown })
        .__PAYMENT_POLL_INTERVAL_MS,
    );
    if (Number.isFinite(windowCustom) && windowCustom > 0) return windowCustom;
  }
  const custom = Number(process.env.NEXT_PUBLIC_PAYMENT_POLL_INTERVAL_MS);
  return Number.isFinite(custom) && custom > 0 ? custom : DEFAULT_POLL_INTERVAL_MS;
}

function getMaxPollAttempts(): number {
  if (typeof window !== "undefined") {
    const windowCustom = Number(
      (window as unknown as { __PAYMENT_POLL_MAX_ATTEMPTS?: unknown })
        .__PAYMENT_POLL_MAX_ATTEMPTS,
    );
    if (Number.isFinite(windowCustom) && windowCustom > 0) return windowCustom;
  }
  const custom = Number(process.env.NEXT_PUBLIC_PAYMENT_POLL_MAX_ATTEMPTS);
  return Number.isFinite(custom) && custom > 0 ? custom : DEFAULT_MAX_POLL_ATTEMPTS;
}

type ReturnState =
  | { readonly kind: "verifying" }
  | { readonly kind: "order_processing" }
  | { readonly kind: "success" }
  | { readonly kind: "failed" }
  | { readonly kind: "timeout" }
  | { readonly kind: "order_delayed" }
  | { readonly kind: "unverified" };

export default function PaymentReturnClient() {
  const { clearCart } = useCart();
  const clearCartRef = useRef(clearCart);
  useEffect(() => {
    clearCartRef.current = clearCart;
  }, [clearCart]);
  const [state, setState] = useState<ReturnState>({ kind: "verifying" });
  const hasClearedCartRef = useRef(false);
  const initialCartIdRef = useRef<string | null>(null);
  if (initialCartIdRef.current === null && typeof window !== "undefined") {
    initialCartIdRef.current = getStoredCartId();
  }
  const hasEverConfirmedPaymentRef = useRef(false);

  useEffect(() => {
    let isMounted = true;
    const abortController = new AbortController();
    let timerId: ReturnType<typeof setTimeout> | null = null;

    // 1. Immediately strip all query parameters from the browser address bar.
    // Never trust client-supplied parameters like ?PaymentId=... or ?Status=...
    if (typeof window !== "undefined" && window.location.search) {
      window.history.replaceState(null, "", window.location.pathname);
    }

    // 2. Initiate bounded polling against the backend status endpoint.
    let attempts = 0;
    const pollInterval = getPollInterval();
    const maxAttempts = getMaxPollAttempts();

    async function pollStatus() {
      if (!isMounted) return;

      // Use the immutable initial cart ID latched on mount.
      // Never switch to a newer cart that might be created concurrently in another tab.
      const initialCartId = initialCartIdRef.current;
      if (!initialCartId || !CART_CAPABILITY_REGEX.test(initialCartId)) {
        setState({ kind: "unverified" });
        return;
      }
      const verifiedCartId = initialCartId;

      attempts += 1;

      try {
        const result: MedusaPaymentStatus | null = await getMedusaPaymentStatus(
          verifiedCartId,
          abortController.signal,
        );

        if (!isMounted) return;

        if (result === null) {
          // 404 / Cart not found or malformed capability: neutral unverified status
          setState({ kind: "unverified" });
          return;
        }

        if (result.payment === "confirmed") {
          hasEverConfirmedPaymentRef.current = true;
        }

        if (result.payment === "confirmed" && result.order === "ready") {
          // Confirmed payment with completed order: clear cart exactly once
          // ONLY if current localStorage still matches the verifiedCartId we just paid!
          setState({ kind: "success" });
          if (!hasClearedCartRef.current) {
            hasClearedCartRef.current = true;
            const currentStoredId = getStoredCartId();
            if (currentStoredId === verifiedCartId) {
              clearCartRef.current();
            }
          }
          return;
        }

        if (result.payment === "confirmed" && result.order === "pending") {
          setState({ kind: "order_processing" });
          if (attempts >= maxAttempts) {
            setState({ kind: "order_delayed" });
            return;
          }
          timerId = setTimeout(pollStatus, pollInterval);
          return;
        }

        if (result.payment === "failed") {
          // Terminal failure: preserve cart items so shopper can retry.
          // If payment was previously confirmed, do not regress to failure!
          if (hasEverConfirmedPaymentRef.current) {
            setState({ kind: "order_delayed" });
            return;
          }
          setState({ kind: "failed" });
          return;
        }

        // result.payment === "pending"
        setState({ kind: "verifying" });
        if (attempts >= maxAttempts) {
          if (hasEverConfirmedPaymentRef.current) {
            setState({ kind: "order_delayed" });
            return;
          }
          setState({ kind: "timeout" });
          return;
        }
        timerId = setTimeout(pollStatus, pollInterval);
      } catch (error) {
        if (!isMounted || abortController.signal.aborted) return;
        console.warn("[PaymentReturn] Status poll error:", error);
        if (attempts >= maxAttempts) {
          if (hasEverConfirmedPaymentRef.current) {
            setState({ kind: "order_delayed" });
            return;
          }
          setState({ kind: "timeout" });
          return;
        }
        timerId = setTimeout(pollStatus, pollInterval);
      }
    }

    pollStatus();

    return () => {
      isMounted = false;
      abortController.abort();
      if (timerId !== null) {
        clearTimeout(timerId);
      }
    };
  }, []);

  return (
    <div className={styles.returnContainer} role="status" aria-live="polite">
      {state.kind === "verifying" && (
        <>
          <div className={styles.returnSpinner} aria-hidden="true" />
          <h2 className={styles.returnTitle}>Проверяем статус оплаты...</h2>
          <p className={styles.returnText}>
            Пожалуйста, не закрывайте страницу. Мы получаем официальное подтверждение от платёжной системы.
          </p>
        </>
      )}

      {state.kind === "order_processing" && (
        <>
          <div className={styles.returnSpinner} aria-hidden="true" />
          <h2 className={styles.returnTitle}>Оплата подтверждена, формируем заказ...</h2>
          <p className={styles.returnText}>
            Платёж успешно принят. Завершаем регистрацию заказа и готовим подтверждение.
          </p>
        </>
      )}

      {state.kind === "success" && (
        <>
          <div className={`${styles.returnIcon} ${styles.returnIconSuccess}`} aria-hidden="true">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <h2 className={styles.returnTitle}>Оплата прошла успешно! Заказ оформлен.</h2>
          <p className={styles.returnText}>
            Спасибо за покупку! Детали вашего заказа и электронный чек отправлены на вашу почту.
          </p>
          <div className={styles.returnActions}>
            <Link href="/catalog" className={styles.submitBtn}>
              Продолжить покупки
            </Link>
          </div>
        </>
      )}

      {state.kind === "failed" && (
        <>
          <div className={`${styles.returnIcon} ${styles.returnIconFailed}`} aria-hidden="true">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <h2 className={styles.returnTitle}>Оплата не была завершена или была отменена</h2>
          <p className={styles.returnText}>
            Средства не были списаны. Все выбранные товары сохранены в вашей корзине, вы можете попробовать снова.
          </p>
          <div className={styles.returnActions}>
            <Link href="/checkout" className={styles.submitBtn}>
              Вернуться к оформлению
            </Link>
          </div>
        </>
      )}

      {state.kind === "timeout" && (
        <>
          <div className={`${styles.returnIcon} ${styles.returnIconFailed}`} aria-hidden="true">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <path d="M12 6v6l4 2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <h2 className={styles.returnTitle}>Оплата не была завершена или была отменена</h2>
          <p className={styles.returnText}>
            Время ожидания ответа от платёжной системы истекло. Товары сохранены в вашей корзине.
          </p>
          <div className={styles.returnActions}>
            <Link href="/checkout" className={styles.submitBtn}>
              Вернуться к оформлению
            </Link>
          </div>
        </>
      )}

      {state.kind === "order_delayed" && (
        <>
          <div className={`${styles.returnIcon} ${styles.returnIconNeutral}`} aria-hidden="true">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <path d="M12 6v6l4 2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <h2 className={styles.returnTitle}>Оплата принята, заказ формируется</h2>
          <p className={styles.returnText}>
            Платёж успешно получен банком. Регистрация заказа в системе занимает чуть больше времени, чем обычно. Пожалуйста, не переживайте: средства уже списаны, подтверждение и детали заказа поступят на вашу электронную почту.
          </p>
          <div className={styles.returnActions}>
            <Link href="/catalog" className={styles.submitBtn}>
              Перейти в каталог
            </Link>
          </div>
        </>
      )}

      {state.kind === "unverified" && (
        <>
          <div className={`${styles.returnIcon} ${styles.returnIconNeutral}`} aria-hidden="true">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <path d="M12 16v-4M12 8h.01" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <h2 className={styles.returnTitle}>Статус платежа не подтверждён</h2>
          <p className={styles.returnText}>
            Не удалось проверить статус оплаты. Если средства были списаны, заказ будет обработан автоматически.
          </p>
          <div className={styles.returnActions}>
            <Link href="/checkout" className={styles.submitBtn}>
              Вернуться к оформлению
            </Link>
            <Link href="/catalog" className={styles.returnButtonSecondary}>
              Перейти в каталог
            </Link>
          </div>
        </>
      )}
    </div>
  );
}
