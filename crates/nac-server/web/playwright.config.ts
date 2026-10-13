import { defineConfig, devices } from "@playwright/test";

import { assertPortalDebuggingDisabled, remoteArtifactPolicy } from "./e2e/remote-config";

const remoteTarget = process.env.NAC_E2E_REMOTE === "1";
if (remoteTarget) assertPortalDebuggingDisabled();
const artifactPolicy = remoteArtifactPolicy();
const artifactDirectory = process.env.NAC_E2E_RUN_ARTIFACT_ROOT;
const configOwner = Number(process.env.NAC_E2E_RUN_CONFIG_PID);
const wrapperOwner = Number(process.env.NAC_E2E_RUN_WRAPPER_PID);
const topLevelRunner = process.ppid === wrapperOwner && !process.env.TEST_WORKER_INDEX;
const ownedWorker = process.ppid === configOwner && process.env.TEST_WORKER_INDEX !== undefined;
if (
  !artifactDirectory ||
  !process.env.NAC_E2E_ARTIFACTS ||
  !process.env.NAC_E2E_RUN_ID ||
  !(topLevelRunner || ownedWorker || process.pid === configOwner)
) {
  throw new Error(
    "Run Playwright through npm run test:e2e -- <flags> so one invocation owns its artifacts",
  );
}
if (topLevelRunner) process.env.NAC_E2E_RUN_CONFIG_PID = String(process.pid);

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.e2e.ts",
  testIgnore: remoteTarget ? ["**/embedded.e2e.ts", "**/managed.e2e.ts"] : "**/remote.e2e.ts",
  outputDir: artifactDirectory,
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
