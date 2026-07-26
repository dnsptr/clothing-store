import { buildReceiptName, TBANK_NAME_MAX } from "../receipt-name";

const len = (s: string) => Array.from(s).length;

describe("buildReceiptName (§6)", () => {
  it("короткое наименование не трогает", () => {
    expect(buildReceiptName("Пальто из шерсти", "ONE SIZE")).toBe(
      "Пальто из шерсти, ONE SIZE"
    );
  });

  it("без суффикса возвращает название как есть", () => {
    expect(buildReceiptName("Пальто из шерсти")).toBe("Пальто из шерсти");
  });

  it("нормализует внешние пробелы", () => {
    expect(buildReceiptName("  Пальто  ", " ONE SIZE ")).toBe(
      "Пальто, ONE SIZE"
    );
  });

  it("режет название товара, сохраняя суффикс варианта целиком", () => {
    const title =
      "Пальто демисезонное из итальянской шерсти с мембраной и отстёгивающимся " +
      "капюшоном на магнитной застёжке лимитированной серии осень-зима";
    const suffix = "M, синий";
    const result = buildReceiptName(title, suffix);

    expect(len(result)).toBeLessThanOrEqual(TBANK_NAME_MAX);
    expect(result.endsWith(", " + suffix)).toBe(true);
    const cutTitle = result.slice(0, -(", " + suffix).length);
    expect(cutTitle.endsWith("…")).toBe(true);
    // Срез по границе слова: перед многоточием нет обрубка с пробелом.
    expect(cutTitle).not.toMatch(/\s…$/);
    // Отрезанное — префикс исходного названия.
    expect(title.startsWith(cutTitle.slice(0, -1))).toBe(true);
  });

  it("ровно на лимите не усекает", () => {
    const suffix = "ONE SIZE";
    const title = "а".repeat(TBANK_NAME_MAX - ", ".length - suffix.length);
    const result = buildReceiptName(title, suffix);
    expect(len(result)).toBe(TBANK_NAME_MAX);
    expect(result.includes("…")).toBe(false);
  });

  it("длина считается в кодовых точках: суррогатные пары не разрезаются", () => {
    const title = "🧥".repeat(TBANK_NAME_MAX + 10);
    const result = buildReceiptName(title);
    expect(len(result)).toBeLessThanOrEqual(TBANK_NAME_MAX);
    // Результат — валидная строка без одиноких половин суррогатных пар.
    expect(result).toBe(Array.from(result).join(""));
  });

  it("отклоняет суффикс, который сам не помещается в лимит", () => {
    expect(() =>
      buildReceiptName("Пальто", "х".repeat(TBANK_NAME_MAX + 5))
    ).toThrow(/суффикс варианта/);
  });

  it("однословное длинное название режется жёстко, но в лимит", () => {
    const result = buildReceiptName("б".repeat(TBANK_NAME_MAX + 40), "S");
    expect(len(result)).toBeLessThanOrEqual(TBANK_NAME_MAX);
    expect(result.endsWith(", S")).toBe(true);
  });
});
