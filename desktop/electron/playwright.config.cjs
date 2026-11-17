"use strict";
const { defineConfig } = require("@playwright/test");
const ci = process.env.NAC_ELECTRON_CI === "1";
module.exports = defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 90000,
  expect: { timeout: 15000 },
  // Discover peer-owned recovery/storage/notification specs automatically. Only
  // explicitly separate manual, visual and diagnostic lanes are excluded.
  testIgnore: ci
    ? [
        "**/development-paths.spec.ts",
        "**/native-manual.spec.ts",
        "**/startup-native-quit.spec.ts",
        "**/pr-visual.spec.ts",
        "**/windowless-quit.spec.ts",
        "**/frame-diagnostic.spec.ts",
        "**/performance-attribution.spec.ts",
        "**/notification-adapter.spec.ts",
      ]
    : [],
  reporter: ci ? [["list"], ["json", { outputFile: process.env.NAC_ELECTRON_CI_REPORT }]] : "list",
  outputDir: process.env.NAC_ELECTRON_CI_RESULTS || "../../target/electron-test-results",
  use: { trace: "off", screenshot: "off", video: "off" },
});
