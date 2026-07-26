import { kopecksToRubles, rublesToKopecks } from "../money";

describe("rublesToKopecks", () => {
  it("конвертирует целые рубли", () => {
    expect(rublesToKopecks(1299)).toBe(129900);
    expect(rublesToKopecks("1299")).toBe(129900);
    expect(rublesToKopecks(0)).toBe(0);
  });

  it("конвертирует копейки в обеих формах записи", () => {
    expect(rublesToKopecks(1299.5)).toBe(129950);
    expect(rublesToKopecks("1299.5")).toBe(129950);
    expect(rublesToKopecks("1299.50")).toBe(129950);
    expect(rublesToKopecks("0.01")).toBe(1);
  });

  it("поглощает двоичный шум float, но не настоящие доли копейки", () => {
    expect(rublesToKopecks(3897.0000000001)).toBe(389700);
    expect(rublesToKopecks(10.0100009)).toBe(1001);
    expect(() => rublesToKopecks(10.0100011)).toThrow(/суб-копеечная/);
    expect(() => rublesToKopecks("10.005")).toThrow(/суб-копеечная/);
    expect(() => rublesToKopecks(10.005)).toThrow(/суб-копеечная/);
  });

  it("принимает объектные формы BigNumberInput Medusa", () => {
    expect(rublesToKopecks({ value: "1299.50" })).toBe(129950);
    expect(
      rublesToKopecks({
        numeric: 1299.5,
        raw: { value: "1299.50" },
        toJSON: () => 1299.5,
        valueOf: () => 1299.5,
      })
    ).toBe(129950);
  });

  it("бросает на мусоре и отрицательных суммах", () => {
    expect(() => rublesToKopecks("12,50")).toThrow();
    expect(() => rublesToKopecks("")).toThrow();
    expect(() => rublesToKopecks("1e3")).toThrow();
    expect(() => rublesToKopecks(-1)).toThrow(/отрицательная/);
    expect(() => rublesToKopecks("-1")).toThrow(/отрицательная/);
    expect(() => rublesToKopecks(NaN)).toThrow();
    expect(() => rublesToKopecks(Infinity)).toThrow();
  });
});

describe("kopecksToRubles", () => {
  it("форматирует с двумя знаками", () => {
    expect(kopecksToRubles(129950)).toBe("1299.50");
    expect(kopecksToRubles(1)).toBe("0.01");
    expect(kopecksToRubles(100)).toBe("1.00");
    expect(kopecksToRubles(0)).toBe("0.00");
  });

  it("бросает на нецелых и отрицательных копейках", () => {
    expect(() => kopecksToRubles(10.5)).toThrow();
    expect(() => kopecksToRubles(-1)).toThrow();
  });
});

describe("round-trip", () => {
  it("рубли → копейки → рубли без потерь", () => {
    for (const amount of ["0.00", "0.01", "1.00", "1299.50", "3897.00"]) {
      expect(kopecksToRubles(rublesToKopecks(amount))).toBe(amount);
    }
  });

  it("копейки → рубли → копейки без потерь", () => {
    for (const kopecks of [0, 1, 99, 100, 129950, 389700]) {
      expect(rublesToKopecks(kopecksToRubles(kopecks))).toBe(kopecks);
    }
  });
});
