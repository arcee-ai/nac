"use strict";
const { defineConfig } = require("@playwright/test");
module.exports = defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 90000,
  expect: { timeout: 15000 },
  reporter: "list",
  outputDir: "../../target/electron-test-results",
});
