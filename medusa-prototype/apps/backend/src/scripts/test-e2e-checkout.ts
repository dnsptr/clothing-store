/**
 * КВАРАНТИН (Task 5 / PAY-005):
 * Сквозной скрипт e2e-чекаута, выводящий paymentUrl как успех, помещён в карантин.
 *
 * Вывод ссылки на оплату в консоль без подтверждённой нотификации, фискализации
 * и списания создаёт ложное впечатление об успешной интеграции.
 *
 * Для сквозной проверки Store API и PostgreSQL без обращения к банку используйте
 *   npm run test:checkout:offline
 * (требуются DB_HOST=localhost, DB_PORT, DB_USERNAME, DB_PASSWORD).
 * Для проверки только Init/GetState без Medusa и PostgreSQL:
 *   npx tsx src/scripts/test-tbank-offline.ts --fixture src/scripts/fixtures/tbank-init-get-state.json
 */

console.error("ОШИБКА: Скрипт test-e2e-checkout.ts помещён в карантин (Task 5).");
console.error("Для сквозной офлайн-проверки Medusa/PostgreSQL: npm run test:checkout:offline");
console.error("Для проверки только Init/GetState: npx tsx src/scripts/test-tbank-offline.ts --fixture src/scripts/fixtures/tbank-init-get-state.json");
process.exit(1);
