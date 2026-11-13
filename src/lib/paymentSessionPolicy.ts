import type { MedusaPaymentSession } from "./medusa";

const APPROVED_TBANK_PAYMENT_HOSTNAMES = new Set([
  "securepay.tinkoff.ru",
  "rest-api-test.tinkoff.ru",
  "pay.tbank-online.com",
]);

const REPLACEABLE_TBANK_SESSION_STATUSES = new Set(["error", "canceled"]);
const REDIRECTABLE_TBANK_SESSION_STATUSES = new Set([
  "pending",
  "requires_more",
  "pending_authorization",
  "authorized",
]);

export type TbankSessionDecision =
  | { readonly kind: "create" }
  | { readonly kind: "redirect"; readonly paymentUrl: string }
  | { readonly kind: "reject"; readonly message: string };

export type DeliveryQuoteConfirmation = {
  readonly shippingOptionId: string;
  readonly selection: string;
  readonly price: number;
  readonly total: number;
};

export function mustReviewDeliveryQuote(
  shown: DeliveryQuoteConfirmation | null,
  current: DeliveryQuoteConfirmation,
): boolean {
  return !shown ||
    shown.shippingOptionId !== current.shippingOptionId ||
    shown.selection !== current.selection ||
    !Number.isFinite(current.price) || !Number.isFinite(current.total) ||
    Math.round(shown.price * 100) !== Math.round(current.price * 100) ||
    Math.round(shown.total * 100) !== Math.round(current.total * 100);
}

export function approvedTbankPaymentUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;

  try {
    const paymentUrl = new URL(value);
    if (
      paymentUrl.protocol !== "https:" ||
      paymentUrl.port ||
      paymentUrl.username ||
      paymentUrl.password ||
      !APPROVED_TBANK_PAYMENT_HOSTNAMES.has(paymentUrl.hostname.toLowerCase())
    ) {
      return null;
    }
    return paymentUrl.toString();
  } catch {
    return null;
  }
}

export function decideTbankSession(
  sessions: readonly MedusaPaymentSession[] | undefined,
  providerId: string,
  expectedAmount: number,
  expectedCurrency: string,
): TbankSessionDecision {
  const providerSessions = sessions?.filter((session) => session.provider_id === providerId) ?? [];
  if (providerSessions.length === 0) return { kind: "create" };

  const protectedSessions = providerSessions.filter(
    (session) => !REPLACEABLE_TBANK_SESSION_STATUSES.has(session.status),
  );
  if (protectedSessions.length === 0) return { kind: "create" };
  if (protectedSessions.length > 1) {
    return { kind: "reject", message: "Найдено несколько активных платёжных сессий. Повторите попытку позже." };
  }

  const session = protectedSessions[0];
  if (!Number.isFinite(expectedAmount) || expectedAmount <= 0 ||
      !Number.isFinite(session.amount) ||
      Math.round(session.amount * 100) !== Math.round(expectedAmount * 100) ||
      session.currency_code !== expectedCurrency) {
    return {
      kind: "reject",
      message: "Сумма или валюта платёжной сессии не соответствует корзине. Оплата не начата.",
    };
  }
  const deadline = session.data.paymentExpiresAt;
  const deadlineTime = typeof deadline === "string" ? Date.parse(deadline) : NaN;
  if (deadline !== undefined &&
      (!Number.isFinite(deadlineTime) || deadlineTime <= Date.now())) {
    return {
      kind: "reject",
      message: "Срок ссылки на оплату истёк. Дождитесь проверки результата банком и повторите оформление.",
    };
  }
  if (!REDIRECTABLE_TBANK_SESSION_STATUSES.has(session.status)) {
    return {
      kind: "reject",
      message: `Платёж уже находится в состоянии ${session.status}. Новый платёж не был создан.`,
    };
  }

  const paymentUrl = approvedTbankPaymentUrl(session.data.paymentUrl);
  if (!paymentUrl) {
    return {
      kind: "reject",
      message: "Ссылка существующей платёжной сессии недействительна. Новый платёж не был создан.",
    };
  }
  return { kind: "redirect", paymentUrl };
}
