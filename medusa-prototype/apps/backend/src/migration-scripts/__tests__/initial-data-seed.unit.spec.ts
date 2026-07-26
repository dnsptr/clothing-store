import { mergeSupportedCurrencies } from "../initial-data-seed";

// Чистый юнит-тест: ни базы, ни поднятого приложения. Проверяет правило, на
// котором сид споткнулся на учении по восстановлению БД 2026-07-27 (§3.1) —
// повторный прогон по восстановленной чужой базе заменил список валют магазина
// целиком, и из трёх валют (rub, eur, usd) осталась одна.
describe("mergeSupportedCurrencies", () => {
  it("добавляет рубль пустому магазину и делает его валютой по умолчанию", () => {
    expect(mergeSupportedCurrencies([])).toEqual([
      { currency_code: "rub", is_default: true, is_tax_inclusive: true },
    ]);
  });

  it("сохраняет чужие валюты и их валюту по умолчанию (учение 2026-07-27)", () => {
    const merged = mergeSupportedCurrencies([
      { currency_code: "eur", is_default: true },
      { currency_code: "usd", is_default: false },
    ]);

    expect(merged.map((currency) => currency.currency_code)).toEqual([
      "eur",
      "usd",
      "rub",
    ]);
    // Ни одна чужая валюта не потеряна и не переназначена.
    expect(merged).toEqual([
      { currency_code: "eur", is_default: true, is_tax_inclusive: undefined },
      { currency_code: "usd", is_default: false, is_tax_inclusive: undefined },
      { currency_code: "rub", is_default: false, is_tax_inclusive: true },
    ]);
  });

  it("не трогает уже настроенный рубль, но подтверждает его gross-цены", () => {
    const merged = mergeSupportedCurrencies([
      { currency_code: "rub", is_default: true },
    ]);

    expect(merged).toEqual([
      { currency_code: "rub", is_default: true, is_tax_inclusive: true },
    ]);
  });

  it("оставляет рубль не по умолчанию, если по умолчанию выбрана другая валюта", () => {
    const merged = mergeSupportedCurrencies([
      { currency_code: "rub", is_default: false },
      { currency_code: "eur", is_default: true },
    ]);

    expect(merged).toEqual([
      { currency_code: "rub", is_default: false, is_tax_inclusive: true },
      { currency_code: "eur", is_default: true, is_tax_inclusive: undefined },
    ]);
  });

  it("назначает рубль по умолчанию, когда выбора нет вовсе", () => {
    // Магазин без валюты по умолчанию роняет validateUpdateRequest ("There
    // should be a default currency set for the store"), то есть весь
    // `db:migrate`. Такой список чиним рублём.
    const merged = mergeSupportedCurrencies([
      { currency_code: "eur", is_default: false },
      { currency_code: "usd", is_default: null },
    ]);

    expect(merged.filter((currency) => currency.is_default)).toEqual([
      { currency_code: "rub", is_default: true, is_tax_inclusive: true },
    ]);
  });

  it("всегда возвращает ровно одну валюту по умолчанию", () => {
    const cases = [
      [],
      [{ currency_code: "rub", is_default: true }],
      [{ currency_code: "eur", is_default: true }],
      [
        { currency_code: "eur", is_default: false },
        { currency_code: "rub", is_default: false },
      ],
    ];

    for (const existingCurrencies of cases) {
      const merged = mergeSupportedCurrencies(existingCurrencies);

      expect(merged.filter((currency) => currency.is_default)).toHaveLength(1);
      // Рубль присутствует в любом исходе — ради него сид и трогает магазин.
      expect(
        merged.some((currency) => currency.currency_code === "rub"),
      ).toBe(true);
    }
  });
});
