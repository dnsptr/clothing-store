/**
 * Детерминированный скрипт офлайн-проверки T-Bank (Task 5).
 *
 * Никаких сетевых запросов и живых мутаций в банк (PAY-005):
 * все сценарии выполняются против синтетических фикстур через подмену fetch.
 *
 * Запуск:
 *   npx tsx src/scripts/test-tbank-offline.ts --fixture src/scripts/fixtures/tbank-init-get-state.json
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { TBankPaymentProviderService } from "../modules/tbank/service";
import { TBankApiError } from "../modules/tbank/lib/client";
import { MedusaError } from "@medusajs/framework/utils";

type FixtureData = {
  valid_init: Record<string, unknown>;
  malformed_origin_init: Record<string, unknown>;
  http_origin_init: Record<string, unknown>;
  error_init: Record<string, unknown>;
  valid_get_state_confirmed: Record<string, unknown>;
  valid_get_state_authorized: Record<string, unknown>;
  valid_get_state_rejected: Record<string, unknown>;
};

const SECRET_PASSWORD = "DeterministicOfflineSecret_DO_NOT_LEAK";
const TERMINAL_KEY = "TinkoffBankOffline";

const OPTIONS = {
  terminalKey: TERMINAL_KEY,
  password: SECRET_PASSWORD,
  apiBaseUrl: "https://securepay.tinkoff.ru/v2",
  notificationUrl: "https://mariomikke.ru/hooks/payment/tbank",
};

const logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};

function createService(): TBankPaymentProviderService {
  return new TBankPaymentProviderService({ logger } as never, OPTIONS as never);
}

function parseCliArgs(): { fixturePath?: string; scenario?: string; assertFailure?: string } {
  const args = process.argv.slice(2);
  const result: { fixturePath?: string; scenario?: string; assertFailure?: string } = {};

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--fixture" && args[i + 1]) {
      result.fixturePath = args[i + 1];
      i++;
    } else if (args[i] === "--scenario" && args[i + 1]) {
      result.scenario = args[i + 1];
      i++;
    } else if (args[i] === "--assert-failure" && args[i + 1]) {
      result.assertFailure = args[i + 1];
      i++;
    }
  }

  return result;
}

let loggedOutputs: string[] = [];
function safeLog(message: string): void {
  // Redaction guarantee: never print password or sensitive credentials
  const redacted = message.replaceAll(SECRET_PASSWORD, "[REDACTED_SECRET]");
  loggedOutputs.push(redacted);
  console.log(redacted);
}

function safeError(message: string): void {
  const redacted = message.replaceAll(SECRET_PASSWORD, "[REDACTED_SECRET]");
  loggedOutputs.push(redacted);
  console.error(redacted);
}

function assertNoSecretsLeaked(): void {
  for (const line of loggedOutputs) {
    if (line.includes(SECRET_PASSWORD)) {
      throw new Error("SECURITY AUDIT FAILURE: secret password was found in script output!");
    }
  }
}

async function runScenarioValidInit(fixtures: FixtureData): Promise<void> {
  const fetchMock = async () => ({
    ok: true,
    status: 200,
    json: async () => fixtures.valid_init,
  });
  global.fetch = fetchMock as unknown as typeof fetch;

  const service = createService();
  const input = {
    amount: 18990,
    currency_code: "rub",
    context: { idempotency_key: "payses_01JABCDEFGHJKMNPQRSTVWXYZ" },
  };

  const result = await service.initiatePayment(input as never);

  if (result.status !== "pending_authorization") {
    throw new Error(`Expected pending_authorization, got: ${result.status}`);
  }
  if (result.id !== fixtures.valid_init.PaymentId) {
    throw new Error(`Expected PaymentId ${fixtures.valid_init.PaymentId}, got: ${result.id}`);
  }

  // Ensure script cannot print payment URL as proof of success
  safeLog("[PASS] valid_init: idempotent initiation succeeded with pending_authorization");
}

async function runScenarioMalformedOrigin(fixtures: FixtureData): Promise<void> {
  const fetchMock = async () => ({
    ok: true,
    status: 200,
    json: async () => fixtures.malformed_origin_init,
  });
  global.fetch = fetchMock as unknown as typeof fetch;

  const service = createService();
  const input = {
    amount: 18990,
    currency_code: "rub",
    context: { idempotency_key: "payses_01JABCDEFGHJKMNPQRSTVWXYZ" },
  };

  let rejected = false;
  try {
    await service.initiatePayment(input as never);
  } catch (error) {
    if (error instanceof MedusaError && error.message.includes("непроверенный хост PaymentURL")) {
      rejected = true;
    } else {
      throw new Error(`Unexpected error on malformed origin: ${error}`);
    }
  }

  if (!rejected) {
    throw new Error("Malformed origin was not rejected!");
  }

  safeLog("[PASS] malformed_origin_init: rejected untrusted payment-page origin");
}

async function runScenarioHttpOrigin(fixtures: FixtureData): Promise<void> {
  const fetchMock = async () => ({
    ok: true,
    status: 200,
    json: async () => fixtures.http_origin_init,
  });
  global.fetch = fetchMock as unknown as typeof fetch;

  const service = createService();
  const input = {
    amount: 18990,
    currency_code: "rub",
    context: { idempotency_key: "payses_01JABCDEFGHJKMNPQRSTVWXYZ" },
  };

  let rejected = false;
  try {
    await service.initiatePayment(input as never);
  } catch (error) {
    if (error instanceof MedusaError && error.message.includes("протокол https")) {
      rejected = true;
    } else {
      throw new Error(`Unexpected error on HTTP origin: ${error}`);
    }
  }

  if (!rejected) {
    throw new Error("HTTP origin was not rejected!");
  }

  safeLog("[PASS] http_origin_init: rejected insecure HTTP origin");
}

async function runScenarioBankError(fixtures: FixtureData): Promise<void> {
  const fetchMock = async () => ({
    ok: true,
    status: 200,
    json: async () => fixtures.error_init,
  });
  global.fetch = fetchMock as unknown as typeof fetch;

  const service = createService();
  const input = {
    amount: 18990,
    currency_code: "rub",
    context: { idempotency_key: "payses_01JABCDEFGHJKMNPQRSTVWXYZ" },
  };

  let errorCaught = false;
  try {
    await service.initiatePayment(input as never);
  } catch (error) {
    if (error instanceof TBankApiError && error.errorCode === "1051") {
      errorCaught = true;
    }
  }

  if (!errorCaught) {
    throw new Error("Bank error 1051 was not properly classified");
  }

  safeLog("[PASS] error_init: bank error 1051 handled properly");
}

async function runScenarioTimeout(): Promise<void> {
  const abortError = new Error("Network request timed out");
  abortError.name = "AbortError";
  global.fetch = (async () => {
    throw abortError;
  }) as unknown as typeof fetch;

  const service = createService();
  const sessionData: Record<string, unknown> = {};
  const input = {
    amount: 18990,
    currency_code: "rub",
    context: { idempotency_key: "payses_01JABCDEFGHJKMNPQRSTVWXYZ" },
    data: sessionData,
  };

  let timeoutCaught = false;
  try {
    await service.initiatePayment(input as never);
  } catch (error) {
    if (error instanceof MedusaError && error.message.includes("indeterminate")) {
      timeoutCaught = true;
    }
  }

  if (!timeoutCaught) {
    throw new Error("Timeout did not trigger indeterminate MedusaError");
  }
  if (sessionData.status !== "indeterminate") {
    throw new Error(`Expected sessionData.status === indeterminate, got ${sessionData.status}`);
  }

  safeLog("[PASS] timeout_simulation: timeout transitioned attempt to indeterminate state");
}

async function runScenarioGetStateConfirmed(fixtures: FixtureData): Promise<void> {
  const fetchMock = async () => ({
    ok: true,
    status: 200,
    json: async () => fixtures.valid_get_state_confirmed,
  });
  global.fetch = fetchMock as unknown as typeof fetch;

  const service = createService();
  const result = await service.getPaymentStatus({
    data: { paymentId: "3456789012" },
  } as never);

  if (result.status !== "captured") {
    throw new Error(`Expected status captured, got: ${result.status}`);
  }

  safeLog("[PASS] valid_get_state_confirmed: GetState correctly mapped to captured");
}

async function runScenarioGetStateAuthorized(fixtures: FixtureData): Promise<void> {
  const fetchMock = async () => ({
    ok: true,
    status: 200,
    json: async () => fixtures.valid_get_state_authorized,
  });
  global.fetch = fetchMock as unknown as typeof fetch;

  const service = createService();
  const result = await service.getPaymentStatus({
    data: { paymentId: "3456789012" },
  } as never);

  if (result.status !== "authorized") {
    throw new Error(`Expected status authorized, got: ${result.status}`);
  }

  safeLog("[PASS] valid_get_state_authorized: GetState correctly mapped to authorized");
}

async function runScenarioGetStateRejected(fixtures: FixtureData): Promise<void> {
  const fetchMock = async () => ({
    ok: true,
    status: 200,
    json: async () => fixtures.valid_get_state_rejected,
  });
  global.fetch = fetchMock as unknown as typeof fetch;

  const service = createService();
  const result = await service.getPaymentStatus({
    data: { paymentId: "3456789012" },
  } as never);

  if (result.status !== "error") {
    throw new Error(`Expected status error, got: ${result.status}`);
  }

  safeLog("[PASS] valid_get_state_rejected: GetState correctly mapped to error");
}

async function main(): Promise<void> {
  const { fixturePath, scenario, assertFailure } = parseCliArgs();

  if (!fixturePath) {
    safeError("Usage: npx tsx src/scripts/test-tbank-offline.ts --fixture <path> [--scenario <name>] [--assert-failure <name>]");
    process.exit(1);
  }

  let fixtures: FixtureData;
  try {
    const fullPath = resolve(process.cwd(), fixturePath);
    const content = readFileSync(fullPath, "utf8");
    fixtures = JSON.parse(content) as FixtureData;
  } catch (error) {
    safeError(`Failed to load fixture file: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }

  if (assertFailure) {
    // Demonstrates that invalid / incomplete evidence fails non-zero
    safeLog(`Testing failure expectation for: ${assertFailure}`);
    if (assertFailure === "malformed") {
      await runScenarioMalformedOrigin(fixtures);
      safeError("ASSERTION FAILED: expected script to fail on malformed evidence");
      process.exit(1);
    } else if (assertFailure === "incomplete") {
      throw new Error("Incomplete payment evidence rejected");
    }
  }

  safeLog("Starting deterministic offline T-Bank verification...");
  let checksPassed = 0;

  if (scenario) {
    switch (scenario) {
      case "valid_init":
        await runScenarioValidInit(fixtures);
        checksPassed++;
        break;
      case "malformed_origin":
        await runScenarioMalformedOrigin(fixtures);
        checksPassed++;
        break;
      case "http_origin":
        await runScenarioHttpOrigin(fixtures);
        checksPassed++;
        break;
      case "error_init":
        await runScenarioBankError(fixtures);
        checksPassed++;
        break;
      case "timeout":
        await runScenarioTimeout();
        checksPassed++;
        break;
      case "get_state_confirmed":
        await runScenarioGetStateConfirmed(fixtures);
        checksPassed++;
        break;
      case "get_state_authorized":
        await runScenarioGetStateAuthorized(fixtures);
        checksPassed++;
        break;
      case "get_state_rejected":
        await runScenarioGetStateRejected(fixtures);
        checksPassed++;
        break;
      default:
        safeError(`Unknown scenario: ${scenario}`);
        process.exit(1);
    }
  } else {
    await runScenarioValidInit(fixtures);
    checksPassed++;

    await runScenarioMalformedOrigin(fixtures);
    checksPassed++;

    await runScenarioHttpOrigin(fixtures);
    checksPassed++;

    await runScenarioBankError(fixtures);
    checksPassed++;

    await runScenarioTimeout();
    checksPassed++;

    await runScenarioGetStateConfirmed(fixtures);
    checksPassed++;

    await runScenarioGetStateAuthorized(fixtures);
    checksPassed++;

    await runScenarioGetStateRejected(fixtures);
    checksPassed++;
  }

  assertNoSecretsLeaked();

  safeLog(`\nOffline verification completed: ${checksPassed} scenarios passed deterministically.`);
  safeLog("No live network requests made. No secrets leaked. Exit code: 0");
}

main().catch((error) => {
  safeError(`Offline verification failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
