const { loadEnv } = require("@medusajs/utils");
loadEnv("test", process.cwd());

module.exports = {
  transform: {
    "^.+\\.[jt]s$": [
      "@swc/jest",
      {
        jsc: {
          parser: { syntax: "typescript", decorators: true },
        },
      },
    ],
  },
  testEnvironment: "node",
  moduleFileExtensions: ["js", "ts", "json"],
  modulePathIgnorePatterns: ["dist/", "<rootDir>/.medusa/"],
  // `modulePathIgnorePatterns` управляет только разрешением модулей, но не
  // отбором тестов. Без явного `testPathIgnorePatterns` после `medusa build`
  // каждый тест запускался дважды — из `src/` и из скомпилированного
  // `.medusa/server/src/` — и jest ругался на коллизию имён пакета. Прогон
  // выглядел зелёным, поэтому проблему было легко не заметить.
  //
  // Паттерны — регулярные выражения по полному пути, а не glob'ы, поэтому
  // разделитель здесь пишется как `[/\\]`: на Windows путь приходит с
  // обратными слэшами, и вариант `<rootDir>/.medusa/` не совпадал бы ни с чем.
  testPathIgnorePatterns: [
    "[/\\\\]node_modules[/\\\\]",
    "[/\\\\]\\.medusa[/\\\\]",
    "[/\\\\]dist[/\\\\]",
  ],
  setupFiles: ["./integration-tests/setup.js"],
};

if (process.env.TEST_TYPE === "integration:http") {
  module.exports.testMatch = ["**/integration-tests/http/*.spec.[jt]s"];
} else if (process.env.TEST_TYPE === "integration:modules") {
  module.exports.testMatch = ["**/src/modules/*/__tests__/**/*.[jt]s"];
  // Юнит-тесты модулей живут в тех же каталогах, но не нуждаются ни в БД, ни в
  // Redis. Без этого исключения `test:integration:modules` поднимал бы
  // окружение ради тестов, которым оно не нужно.
  module.exports.testPathIgnorePatterns = [
    ...module.exports.testPathIgnorePatterns,
    "\\.unit\\.spec\\.[jt]s$",
  ];
} else if (process.env.TEST_TYPE === "unit") {
  module.exports.testMatch = ["**/src/**/__tests__/**/*.unit.spec.[jt]s"];
}
