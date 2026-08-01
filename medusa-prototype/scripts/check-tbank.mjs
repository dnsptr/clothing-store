import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

if (!process.env.NODE_EXTRA_CA_CERTS && process.env.TBANK_CA_BOOTSTRAPPED !== "1") {
  const caPath = fileURLToPath(
    new URL("../apps/backend/certificates/russian_trusted_root_ca.crt", import.meta.url),
  );
  const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], {
    env: {
      ...process.env,
      NODE_EXTRA_CA_CERTS: caPath,
      TBANK_CA_BOOTSTRAPPED: "1",
    },
    stdio: "inherit",
  });
  process.exit(child.status ?? 1);
}

const required = (name) => {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is missing in medusa-prototype/apps/backend/.env.integrations.local`);
  }
  return value;
};

const baseUrl = required("TBANK_API_BASE_URL").replace(/\/$/, "");
const terminalKey = required("TBANK_TERMINAL_KEY");
const password = required("TBANK_PASSWORD");

function generateToken(params) {
  const values = Object.entries({ ...params, Password: password })
    .filter(([key, value]) => key !== "Token" && ["string", "number", "boolean"].includes(typeof value))
    .sort(([left], [right]) => left.localeCompare(right, "en"))
    .map(([, value]) => String(value))
    .join("");
  return createHash("sha256").update(values, "utf8").digest("hex");
}

async function main() {
  console.log(`T-Bank environment: ${baseUrl}`);
  const body = {
    TerminalKey: terminalKey,
    OrderId: `credential-check-${Date.now()}`,
  };
  body.Token = generateToken(body);

  const response = await fetch(`${baseUrl}/CheckOrder`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    const summary = text.replace(/\s+/g, " ").trim().slice(0, 200);
    throw new Error(
      `T-Bank returned non-JSON HTTP ${response.status}` + (summary ? `: ${summary}` : ""),
    );
  }
  if (!response.ok) {
    throw new Error(`T-Bank returned HTTP ${response.status}`);
  }

  const errorCode = String(payload?.ErrorCode ?? "UNKNOWN");
  if (payload?.Success === true) {
    console.log("Signed CheckOrder request: OK");
    return;
  }
  if (errorCode === "914" || errorCode === "407" || errorCode === "63") {
    console.log(`Credentials and signature: OK (expected missing-order response ${errorCode})`);
    return;
  }
  if (errorCode === "204" || errorCode === "205" || errorCode === "2015") {
    throw new Error(`credentials or signature rejected [${errorCode}]: ${payload?.Message || "no message"}`);
  }
  throw new Error(
    `unexpected API response [${errorCode}]: ${payload?.Message || "no message"}` +
      (payload?.Details ? ` (${payload.Details})` : ""),
  );
}

main().catch((error) => {
  console.error(`T-Bank check failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
