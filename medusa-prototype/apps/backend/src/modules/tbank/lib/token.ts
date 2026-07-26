/**
 * Подпись запросов и проверка подписи нотификаций Т-Банка.
 *
 * Алгоритм и правила приведения к строке зафиксированы в проектном решении
 * (docs/design/tbank-payments-and-fiscalization.md, §5.4): берутся параметры
 * верхнего уровня кроме `Token` и вложенных объектов/массивов (`Receipt`,
 * `DATA`, `Shops`…), добавляется пара `Password`, ключи сортируются по
 * алфавиту, конкатенируются только значения, от результата берётся
 * SHA-256 (UTF-8, hex строчными).
 *
 * Приведение значений: `true` → "true" (строчными), числа — без
 * форматирования (`189900` → "189900"), `null`/`undefined` в конкатенацию
 * не попадают. Токен считается по разобранным полям, а не по байтам тела.
 */

import { createHash, timingSafeEqual } from "crypto";

/** Скалярное значение поля запроса/нотификации → строка по правилам §5.4. */
export function tokenValueToString(value: string | number | boolean): string {
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(`tokenValueToString: не число: ${value}`);
    }
    return String(value);
  }
  return value;
}

function isScalar(value: unknown): value is string | number | boolean {
  return (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

/**
 * Токен для исходящего запроса (`Init`, `Cancel`, `GetState`…).
 * `params` — тело запроса без `Token`; вложенные объекты и null-поля
 * отбрасываются здесь, передавать их не ошибка.
 */
export function generateToken(
  params: Record<string, unknown>,
  password: string
): string {
  const pairs: Array<[string, string]> = [];
  for (const [key, value] of Object.entries(params)) {
    if (key === "Token" || key === "Password" || !isScalar(value)) {
      continue;
    }
    pairs.push([key, tokenValueToString(value)]);
  }
  pairs.push(["Password", password]);
  // Ключи Т-Банка — ASCII; сортировка по кодовым единицам и есть «по алфавиту».
  pairs.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  const concatenated = pairs.map(([, v]) => v).join("");
  return createHash("sha256").update(concatenated, "utf8").digest("hex");
}

/**
 * Проверка подписи входящей нотификации. Несовпадение — уведомление
 * отбрасывается без ответа `OK` (§5.4). Сравнение — постоянное по времени.
 */
export function verifyNotificationToken(
  payload: Record<string, unknown>,
  password: string
): boolean {
  const received = payload["Token"];
  if (typeof received !== "string" || received.length === 0) {
    return false;
  }
  const expected = generateToken(payload, password);
  const receivedBuf = Buffer.from(received.toLowerCase(), "utf8");
  const expectedBuf = Buffer.from(expected, "utf8");
  if (receivedBuf.length !== expectedBuf.length) {
    return false;
  }
  return timingSafeEqual(receivedBuf, expectedBuf);
}
