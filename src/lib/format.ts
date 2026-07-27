export function formatPrice(price: number) {
  return `${price.toLocaleString("ru-RU")} ₽`;
}

/** Показывается вместо суммы, которую витрина не смогла подтвердить у сервера. */
export const UNKNOWN_PRICE = "—";

/**
 * Отформатировать сумму, которой может не быть.
 *
 * `null` означает «сервер не подтвердил сумму». Подставлять вместо неё
 * посчитанную на клиенте цифру нельзя: покупатель воспримет её как цену к
 * оплате, а списано будет то, что насчитает backend (ADR-001 §5).
 */
export function formatPriceOrUnknown(price: number | null) {
  return price === null ? UNKNOWN_PRICE : formatPrice(price);
}
