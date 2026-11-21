const STORAGE_KEY = "clothing-store-cart-access";
const TOKEN_PATTERN = /^[a-f0-9]{64}$/;

/** Cart IDs are public references; this separate capability is never put in URLs. */
export function getCartAccessToken(cartId: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const tokens: unknown = raw ? JSON.parse(raw) : {};
    if (!tokens || typeof tokens !== "object" || Array.isArray(tokens)) return null;
    const token = (tokens as Record<string, unknown>)[cartId];
    return typeof token === "string" && TOKEN_PATTERN.test(token) ? token : null;
  } catch {
    return null;
  }
}

export function rememberCartAccessToken(cartId: string, token: string): void {
  if (!TOKEN_PATTERN.test(token)) throw new Error("Некорректный ключ доступа к корзине.");
  const raw = window.localStorage.getItem(STORAGE_KEY);
  let tokens: unknown;
  try { tokens = raw ? JSON.parse(raw) : {}; } catch { tokens = {}; }
  const stored = tokens && typeof tokens === "object" && !Array.isArray(tokens)
    ? tokens as Record<string, unknown> : {};
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...stored, [cartId]: token }));
}
