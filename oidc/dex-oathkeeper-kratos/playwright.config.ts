import { existsSync, readFileSync } from "node:fs";
import { defineConfig } from "@playwright/test";

// Playwright's test process needs SESSION_SECRET to decrypt/encode session cookies directly
// (silent-reauth.spec.ts, reauth-invalid.spec.ts) — load it from the same .env the dev server and
// Docker Compose read, so there is one source of truth for secrets (no drift, no separate copy).
const envPath = new URL("./.env", import.meta.url).pathname;
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf-8").split("\n")) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (match && !(match[1] in process.env)) {
      process.env[match[1]] = match[2];
    }
  }
}

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  use: {
    baseURL: process.env.BASE_URL ?? "http://localhost:3000",
    trace: "on-first-retry",
  },
});
