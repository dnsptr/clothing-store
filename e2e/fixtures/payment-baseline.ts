import { spawn, type ChildProcess } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { FixtureServerError, startStoreApiFixture } from "./store-api-fixture";

export {
  BANK_PAYMENT_URL,
  DEFAULT_FIXTURE_URL,
  type PaymentScenario,
} from "./store-api-fixture";

export const DEFAULT_APP_URL = "http://127.0.0.1:4173";

async function waitForCheckout(appUrl: string, child: ChildProcess): Promise<void> {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new FixtureServerError(`Next checkout exited before readiness with ${child.exitCode}`);
    }
    try {
      const response = await fetch(appUrl, { signal: AbortSignal.timeout(5_000) });
      if (response.status < 500) return;
    } catch (error) {
      if (!(error instanceof TypeError || error instanceof DOMException)) throw error;
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }
  throw new FixtureServerError("Timed out waiting for the real Next checkout surface");
}

function parsePort(flag: string, fallback: number): number {
  const index = process.argv.indexOf(flag);
  const value = index >= 0 ? Number(process.argv[index + 1]) : fallback;
  if (!Number.isInteger(value) || value < 1 || value > 65_535) {
    throw new FixtureServerError(`Invalid ${flag}`);
  }
  return value;
}

async function runFixtureProcess(): Promise<void> {
  const appPort = parsePort("--app-port", 4173);
  const apiPort = parsePort("--api-port", 4174);
  const appUrl = `http://127.0.0.1:${appPort}`;
  const api = await startStoreApiFixture(apiPort);
  const repositoryRoot = process.cwd();
  const nextProcess = spawn(
    process.execPath,
    [resolve(repositoryRoot, "node_modules/next/dist/bin/next"), "dev", "--hostname", "127.0.0.1", "--port", String(appPort)],
    {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        DATA_MODE: "medusa",
        MEDUSA_BACKEND_URL: api.url,
        MEDUSA_PUBLISHABLE_KEY: "pk_payment_fixture",
        MEDUSA_REGION_ID: "reg_fixture_ru",
        NEXT_PUBLIC_DATA_MODE: "medusa",
        NEXT_PUBLIC_MEDUSA_BACKEND_URL: api.url,
        NEXT_PUBLIC_MEDUSA_PAYMENT_PROVIDER_ID: "pp_tbank_tbank",
        NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY: "pk_payment_fixture",
        NEXT_PUBLIC_MEDUSA_REGION_ID: "reg_fixture_ru",
        NEXT_TELEMETRY_DISABLED: "1",
      },
      stdio: "inherit",
    },
  );

  try {
    await waitForCheckout(appUrl, nextProcess);
  } catch (error) {
    nextProcess.kill();
    await api.close();
    throw error;
  }
  const readyFileIndex = process.argv.indexOf("--ready-file");
  const readyFile = readyFileIndex >= 0 ? process.argv[readyFileIndex + 1] : undefined;
  const readiness = JSON.stringify({ appUrl, fixtureUrl: api.url });
  if (readyFile) await writeFile(readyFile, readiness, "utf8");
  else console.log(readiness);

  let stopping = false;
  const stop = async (): Promise<void> => {
    if (stopping) return;
    stopping = true;
    nextProcess.kill();
    await api.close();
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}

if (process.argv.includes("--app-port")) {
  void runFixtureProcess().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
