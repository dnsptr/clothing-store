/**
 * Наименование позиции чека: «товар + вариант», лимит Т-Банка — 128 символов.
 *
 * Правило усечения зафиксировано в проектном решении (docs/design/
 * tbank-payments-and-fiscalization.md, §6): режется название товара, суффикс
 * варианта (`ONE SIZE`, размер, цвет) сохраняется целиком, срез — по границе
 * слова, с многоточием. Артикул в наименование не входит.
 *
 * Длина считается в кодовых точках Unicode, чтобы не разрезать суррогатную
 * пару посередине.
 */

export const TBANK_NAME_MAX = 128;

const ELLIPSIS = "…";
const SEPARATOR = ", ";

function codePoints(value: string): string[] {
  return Array.from(value);
}

function truncateAtWordBoundary(value: string, max: number): string {
  const points = codePoints(value);
  if (points.length <= max) {
    return value;
  }
  // Одна кодовая точка уходит под многоточие.
  const hard = points.slice(0, max - 1).join("");
  const lastSpace = hard.lastIndexOf(" ");
  const cut = lastSpace > 0 ? hard.slice(0, lastSpace) : hard;
  return cut.trimEnd() + ELLIPSIS;
}

/**
 * Собирает `Name` позиции чека из названия товара и суффикса варианта.
 * Суффикс не передаётся для безразмерных товаров без вариантных осей —
 * тогда усечению подлежит всё наименование.
 */
export function buildReceiptName(
  productTitle: string,
  variantSuffix?: string
): string {
  const title = productTitle.trim();
  const suffix = variantSuffix?.trim();

  if (!suffix) {
    return truncateAtWordBoundary(title, TBANK_NAME_MAX);
  }

  const full = title + SEPARATOR + suffix;
  if (codePoints(full).length <= TBANK_NAME_MAX) {
    return full;
  }

  const reservedForSuffix = codePoints(SEPARATOR + suffix).length;
  const titleBudget = TBANK_NAME_MAX - reservedForSuffix;
  if (titleBudget >= 2) {
    return truncateAtWordBoundary(title, titleBudget) + SEPARATOR + suffix;
  }

  throw new Error(
    `buildReceiptName: суффикс варианта не помещается в ${TBANK_NAME_MAX} символов`
  );
}
