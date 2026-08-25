import { defineConfig, devices } from "@playwright/test";
import os from "node:os";
import path from "node:path";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.e2e.ts",
  outputDir: process.env.NAC_E2E_ARTIFACTS ?? path.join(os.tmpdir(), "nac-playwright-results"),
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: "list",
  use: {
    ...devices["Desktop Chrome"],
    serviceWorkers: "block",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
});
