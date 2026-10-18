import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "medusa-prototype/**",
    "next-env.d.ts",
    // Local worktrees and tool output are not application source.
    ".slim/**",
    ".claude/worktrees/**",
    ".omo/**",
    ".opencode/**",
    ".npm-cache/**",
    ".playwright-mcp/**",
    ".vercel/**",
    "coverage/**",
    "playwright-report/**",
    "test-results/**",
  ]),
]);

export default eslintConfig;
