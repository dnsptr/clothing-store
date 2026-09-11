/**
 * КВАРАНТИН (Task 5 / PAY-005):
 * Сквозной скрипт e2e-чекаута, выводящий paymentUrl как успех, помещён в карантин.
 *
 * Вывод ссылки на оплату в консоль без подтверждённой нотификации, фискализации
 * и списания создаёт ложное впечатление об успешной интеграции.
 *
 * Для детерминированной проверки логики Init и GetState используйте:
 *   npx tsx src/scripts/test-tbank-offline.ts --fixture src/scripts/fixtures/tbank-init-get-state.json
 */

console.error("ОШИБКА: Скрипт test-e2e-checkout.ts помещён в карантин (Task 5).");
console.error("Для проверки используйте детерминированный офлайн-раннер:");
console.error("  npx tsx src/scripts/test-tbank-offline.ts --fixture src/scripts/fixtures/tbank-init-get-state.json");
process.exit(1);
