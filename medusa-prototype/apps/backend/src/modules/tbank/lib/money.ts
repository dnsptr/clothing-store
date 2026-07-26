/**
 * Конверсия рубли ↔ копейки для Т-Банка.
 *
 * Medusa оперирует суммами в рублях (major units, BigNumberInput), Т-Банк —
 * исключительно копейками. Проектное решение (docs/design/
 * tbank-payments-and-fiscalization.md, §2) требует, чтобы конверсия была
 * одной функцией с round-trip тестом, а не выражением `* 100` по месту.
 *
 * Суб-копеечная точность на входе — ошибка вызывающего кода: чек не может
 * содержать долей копейки, а молчаливое округление здесь скрыло бы расход
 * копеек между заказом и чеком (§7). Исключение — плавающий «шум» двоичного
 * представления (≤1e-6 рубля), который поглощается нормализацией.
 */

const DECIMAL_RE = /^(\d+)(?:\.(\d+))?$/;

/** Сумма в рублях → целые копейки. Бросает на отрицательных, нечисловых и
 * суб-копеечных значениях. */
export function rublesToKopecks(amount: string | number): number {
  let normalized: string;
  if (typeof amount === "number") {
    if (!Number.isFinite(amount)) {
      throw new Error(`rublesToKopecks: не число: ${amount}`);
    }
    if (amount < 0) {
      throw new Error(`rublesToKopecks: отрицательная сумма: ${amount}`);
    }
    // toFixed(6) поглощает двоичный шум (3897.0000000001 → "3897.000000"),
    // но сохраняет настоящие суб-копеечные доли, чтобы их отловила проверка ниже.
    normalized = amount.toFixed(6);
  } else {
    normalized = amount.trim();
    if (normalized.startsWith("-")) {
      throw new Error(`rublesToKopecks: отрицательная сумма: ${amount}`);
    }
  }

  const match = DECIMAL_RE.exec(normalized);
  if (!match) {
    throw new Error(`rublesToKopecks: не десятичное число: ${amount}`);
  }

  const [, whole, fraction = ""] = match;
  const kopeckDigits = fraction.slice(0, 2).padEnd(2, "0");
  const subKopeck = fraction.slice(2);
  if (/[1-9]/.test(subKopeck)) {
    throw new Error(
      `rublesToKopecks: суб-копеечная точность недопустима: ${amount}`
    );
  }

  const kopecks = Number(whole) * 100 + Number(kopeckDigits);
  if (!Number.isSafeInteger(kopecks)) {
    throw new Error(`rublesToKopecks: сумма вне safe integer: ${amount}`);
  }
  return kopecks;
}

/** Целые копейки → строка в рублях с двумя знаками ("38.97"). Строка — потому
 * что это валидный BigNumberInput без двоичной погрешности деления. */
export function kopecksToRubles(kopecks: number): string {
  if (!Number.isSafeInteger(kopecks) || kopecks < 0) {
    throw new Error(`kopecksToRubles: ожидались целые копейки ≥ 0: ${kopecks}`);
  }
  const whole = Math.floor(kopecks / 100);
  const rest = kopecks % 100;
  return `${whole}.${String(rest).padStart(2, "0")}`;
}
