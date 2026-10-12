import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, mergeConfig } from "vite";
import nativeConfiguration from "../vite.config";

const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export default defineConfig(async (environment) => {
  const native =
    typeof nativeConfiguration === "function"
      ? await nativeConfiguration(environment)
      : nativeConfiguration;
  if (!process.env.NAC_HOSTED_FIXTURE_OUTPUT)
    throw new Error("Missing isolated hosted fixture output");
  return mergeConfig(native, {
    root: web,
    base: "/",
    build: {
      outDir: process.env.NAC_HOSTED_FIXTURE_OUTPUT,
      rollupOptions: { input: path.join(web, "e2e/fixtures/hosted.html") },
    },
  });
});
