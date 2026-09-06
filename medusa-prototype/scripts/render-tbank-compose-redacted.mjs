import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const projectDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const rendered = spawnSync(
  "docker",
  [
    "compose",
    "--env-file",
    resolve(
      projectDirectory,
      "apps/backend/src/lib/__tests__/fixtures/compose.production.env",
    ),
    "-f",
    resolve(projectDirectory, "compose.production.yml"),
    "config",
    "--format",
    "json",
  ],
  { encoding: "utf8", timeout: 30_000 },
);

if (rendered.status !== 0) {
  process.stderr.write("Client-only Docker Compose config validation failed\n");
  process.exit(1);
}

const config = JSON.parse(rendered.stdout);
const environment = config?.services?.medusa?.environment;
if (!environment || typeof environment !== "object" || Array.isArray(environment)) {
  process.stderr.write("Rendered Compose config has no Medusa environment\n");
  process.exit(1);
}

const names = Object.keys(environment)
  .filter((name) => name.startsWith("TBANK_"))
  .sort();
if (names.length !== 8) {
  process.stderr.write(`Expected 8 TBANK variables, received ${names.length}\n`);
  process.exit(1);
}

for (const name of names) {
  process.stdout.write(`${name}=<redacted>\n`);
}
