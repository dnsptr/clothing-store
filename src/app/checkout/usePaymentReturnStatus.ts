"use client";

import { useEffect, useRef, useState } from "react";
import { getStoredCartId, useCart } from "@/context/CartContext";
import { getMedusaPaymentStatus } from "@/lib/medusa";
import { getPaymentPollConfig } from "./paymentPollConfig";
import type { PaymentReturnState } from "./paymentReturnState";

const CART_CAPABILITY_REGEX = /^cart_[0-9A-HJKMNP-TV-Z]{26}$/;

export function usePaymentReturnStatus(): PaymentReturnState {
  const { clearCart } = useCart();
  const clearCartRef = useRef(clearCart);
  const initialCartIdRef = useRef<string | null>(null);
  const hasClearedCartRef = useRef(false);
  const hasEverConfirmedPaymentRef = useRef(false);
  const [state, setState] = useState<PaymentReturnState>({ kind: "verifying" });

  useEffect(() => {
    clearCartRef.current = clearCart;
  }, [clearCart]);

  useEffect(() => {
    let isMounted = true;
    const abortController = new AbortController();
    let timerId: ReturnType<typeof setTimeout> | null = null;
    initialCartIdRef.current = getStoredCartId();

    if (window.location.search) {
      window.history.replaceState(null, "", window.location.pathname);
    }

    let attempts = 0;
    const { intervalMs, maxAttempts } = getPaymentPollConfig();

    const finishAfterExhaustion = () => {
      setState({ kind: hasEverConfirmedPaymentRef.current ? "order_delayed" : "timeout" });
    };

    const scheduleNextPoll = () => {
      timerId = setTimeout(pollStatus, intervalMs);
    };

    async function pollStatus(): Promise<void> {
      if (!isMounted) return;

      const verifiedCartId = initialCartIdRef.current;
      if (!verifiedCartId || !CART_CAPABILITY_REGEX.test(verifiedCartId)) {
        setState({ kind: "unverified" });
        return;
      }

      attempts += 1;

      try {
        const result = await getMedusaPaymentStatus(verifiedCartId, abortController.signal);
        if (!isMounted) return;

        if (result === null) {
          setState({ kind: "unverified" });
          return;
        }

        if (result.payment === "confirmed") {
          hasEverConfirmedPaymentRef.current = true;
          if (result.order === "ready") {
            setState({ kind: "success" });
            if (!hasClearedCartRef.current) {
              hasClearedCartRef.current = true;
              if (getStoredCartId() === verifiedCartId) {
                clearCartRef.current();
              }
            }
            return;
          }

          setState({ kind: "order_processing" });
          if (attempts >= maxAttempts) {
            setState({ kind: "order_delayed" });
            return;
          }
          scheduleNextPoll();
          return;
        }

        if (result.payment === "failed") {
          setState({ kind: hasEverConfirmedPaymentRef.current ? "order_delayed" : "failed" });
          return;
        }

        setState({ kind: "verifying" });
        if (attempts >= maxAttempts) {
          finishAfterExhaustion();
          return;
        }
        scheduleNextPoll();
      } catch (error) {
        if (!isMounted || abortController.signal.aborted) return;
        if (process.env.NODE_ENV !== "production") {
          console.warn("[PaymentReturn] Status poll error:", error);
        }
        if (attempts >= maxAttempts) {
          finishAfterExhaustion();
          return;
        }
        scheduleNextPoll();
      }
    }

    void pollStatus();

    return () => {
      isMounted = false;
      abortController.abort();
      if (timerId !== null) clearTimeout(timerId);
    };
  }, []);

  return state;
}
