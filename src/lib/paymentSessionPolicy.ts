import type { MedusaPaymentSession } from "./medusa";

const APPROVED_TBANK_PAYMENT_HOSTNAMES = new Set([
  "securepay.tinkoff.ru",
  "rest-api-test.tinkoff.ru",
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

export function approvedTbankPaymentUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;

  try {
    const paymentUrl = new URL(value);
    if (
      paymentUrl.protocol !== "https:" ||
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
