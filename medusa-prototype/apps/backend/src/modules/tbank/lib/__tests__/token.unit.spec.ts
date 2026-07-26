import {
  generateToken,
  tokenValueToString,
  verifyNotificationToken,
} from "../token";

// Эталонный пример из документации Т-Банка (раздел «Подпись запроса»):
// Init с TerminalKey=MerchantTerminalKey, Amount=19200, OrderId=21090,
// Description=«Подарочная карта на 1000 рублей», Password=usaf8fw8fsw21g.
// Конкатенация по алфавиту ключей: Amount, Description, OrderId, Password,
// TerminalKey. Проектное решение §13 требует этот тест как первый.
const DOC_EXAMPLE = {
  TerminalKey: "MerchantTerminalKey",
  Amount: 19200,
  OrderId: "21090",
  Description: "Подарочная карта на 1000 рублей",
};
const DOC_PASSWORD = "usaf8fw8fsw21g";
const DOC_TOKEN =
  "0024a00af7c350a3a67ca168ce06502aa72772456662e38696d48b56ee9c97d9";

describe("tokenValueToString (§5.4)", () => {
  it("булево — строчными", () => {
    expect(tokenValueToString(true)).toBe("true");
    expect(tokenValueToString(false)).toBe("false");
  });

  it("числа — без форматирования", () => {
    expect(tokenValueToString(189900)).toBe("189900");
    expect(tokenValueToString(0)).toBe("0");
  });

  it("строки — как есть", () => {
    expect(tokenValueToString("payses_01ABC")).toBe("payses_01ABC");
  });
});

describe("generateToken", () => {
  it("совпадает с эталонным примером из документации банка", () => {
    expect(generateToken(DOC_EXAMPLE, DOC_PASSWORD)).toBe(DOC_TOKEN);
  });

  it("вложенные объекты (Receipt, DATA) и null-поля не участвуют", () => {
    const withNoise = {
      ...DOC_EXAMPLE,
      Receipt: { Items: [{ Name: "x", Amount: 19200 }] },
      DATA: { connection_type: "Widget2.0" },
      Recurrent: null,
      CustomerKey: undefined,
    };
    expect(generateToken(withNoise, DOC_PASSWORD)).toBe(DOC_TOKEN);
  });

  it("уже присутствующий Token игнорируется", () => {
    expect(
      generateToken({ ...DOC_EXAMPLE, Token: "мусор" }, DOC_PASSWORD)
    ).toBe(DOC_TOKEN);
  });

  it("сортировка по имени параметра, а не по порядку в объекте", () => {
    const reversed = Object.fromEntries(
      Object.entries(DOC_EXAMPLE).reverse()
    );
    expect(generateToken(reversed, DOC_PASSWORD)).toBe(DOC_TOKEN);
  });
});

describe("verifyNotificationToken", () => {
  // Токен нотификации считается по той же схеме; Success — булево.
  const notification = {
    TerminalKey: "MerchantTerminalKey",
    OrderId: "payses_01ABC",
    Success: true,
    Status: "CONFIRMED",
    PaymentId: 2304882,
    Amount: 129950,
  };
  const signed = {
    ...notification,
    Token: generateToken(notification, DOC_PASSWORD),
  };

  it("принимает корректную подпись", () => {
    expect(verifyNotificationToken(signed, DOC_PASSWORD)).toBe(true);
  });

  it("принимает токен в верхнем регистре", () => {
    expect(
      verifyNotificationToken(
        { ...signed, Token: signed.Token.toUpperCase() },
        DOC_PASSWORD
      )
    ).toBe(true);
  });

  it("отклоняет подмену любого поля", () => {
    expect(
      verifyNotificationToken({ ...signed, Amount: 1 }, DOC_PASSWORD)
    ).toBe(false);
    expect(
      verifyNotificationToken({ ...signed, Success: false }, DOC_PASSWORD)
    ).toBe(false);
    expect(
      verifyNotificationToken({ ...signed, Status: "AUTHORIZED" }, DOC_PASSWORD)
    ).toBe(false);
  });

  it("отклоняет неверный пароль, пустой и отсутствующий Token", () => {
    expect(verifyNotificationToken(signed, "другой-пароль")).toBe(false);
    expect(
      verifyNotificationToken({ ...notification, Token: "" }, DOC_PASSWORD)
    ).toBe(false);
    expect(verifyNotificationToken(notification, DOC_PASSWORD)).toBe(false);
  });

  it("Success: true и Success: 'true' дают одну подпись — фиксируем это явно", () => {
    // Приведение §5.4 намеренно совпадает с JSON-представлением банка:
    // если банк пришлёт строку "true" вместо булева, подпись не разойдётся.
    const asString = { ...notification, Success: "true" };
    expect(generateToken(asString, DOC_PASSWORD)).toBe(
      generateToken(notification, DOC_PASSWORD)
    );
  });
});
