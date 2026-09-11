/**
 * КВАРАНТИН (Task 5 / PAY-005):
 * Вызов боевых или тестовых мутирующих методов (Init, FinishAuthorize, Cancel, Refund)
 * запрещён в процессе валидации релиза.
 *
 * Успешный ответ Init / ссылка на оплату НЕ ЯВЛЯЮТСЯ доказательством завершённой сделки
 * с фискализацией и маркировкой (Честный Знак). Скрипт не может печатать Payment URL как доказательство успеха.
 *
 * Для детерминированной проверки используйте:
 *   npx tsx src/scripts/test-tbank-offline.ts --fixture src/scripts/fixtures/tbank-init-get-state.json
 */

console.error("ОШИБКА: Скрипт test-tbank.ts помещён в карантин (Task 5).");
console.error("Выполнение реальных мутаций API Т-Банка отключено.");
console.error("Для проверки используйте детерминированный офлайн-раннер:");
console.error("  npx tsx src/scripts/test-tbank-offline.ts --fixture src/scripts/fixtures/tbank-init-get-state.json");
process.exit(1);
