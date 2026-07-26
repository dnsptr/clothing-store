// Build the GitHub Pages artifact (static export).
//
// This exists only to set BUILD_TARGET=pages in a cross-platform way. The npm
// script cannot do it inline: npm runs scripts through cmd.exe on Windows,
// where `BUILD_TARGET=pages next build` is not valid syntax and fails with
// "BUILD_TARGET is not recognized as an internal or external command". A Node
// wrapper keeps `npm run build:pages` working on Windows, macOS and the Linux
// CI runners without adding a cross-env dependency.
//
// The Vercel artifact needs no wrapper — `npm run build` is the default target.
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

// Resolve Next's own bin instead of relying on PATH/shell resolution, so the
// wrapper behaves identically however npm was invoked.
const nextBin = require.resolve("next/dist/bin/next");

const { status, error } = spawnSync(process.execPath, [nextBin, "build"], {
  stdio: "inherit",
  env: { ...process.env, BUILD_TARGET: "pages" },
});

if (error) {
  console.error(error);
  process.exit(1);
}

process.exit(status ?? 1);
