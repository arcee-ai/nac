import { defineConfig, devices } from "@playwright/test";
import os from "node:os";
import path from "node:path";

import { assertPortalDebuggingDisabled, remoteArtifactPolicy } from "./e2e/remote-config";

const remoteTarget = process.env.NAC_E2E_REMOTE === "1";
if (remoteTarget) assertPortalDebuggingDisabled();
const artifactPolicy = remoteArtifactPolicy();

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.e2e.ts",
  testIgnore: remoteTarget ? ["**/embedded.e2e.ts", "**/managed.e2e.ts"] : "**/remote.e2e.ts",
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
    ...artifactPolicy,
  },
});
