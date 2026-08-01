import path from "node:path";
import { fileURLToPath } from "node:url";
import { transformAsync } from "@babel/core";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// The bundle is emitted into the crate's `assets/` tree because the Rust server
// embeds that directory with `include_dir!` and serves it under `/assets/`.
// `base` has to match the serving prefix or hashed chunk URLs resolve to 404.
const OUT_DIR = path.resolve(__dirname, "../assets/dist");
const BASE = "/assets/dist/";

// Prefixes owned by the axum API router; everything else is frontend.
const API_PREFIXES = [
  "/health",
  "/store",
  "/sessions",
  "/credentials",
  "/fs",
  "/providers",
  "/model-configs",
];
const API_TARGET = process.env.NAC_API_URL ?? "http://127.0.0.1:3210";

/**
 * Marks every element with the source position Locator opens on Alt-click.
 *
 * React 19 dropped the fiber `_debugSource` that Locator's DevTools adapter
 * read, so these attributes are the only way left to resolve a rendered element
 * back to a file. The React plugin runs on oxc and no longer takes Babel
 * plugins, hence this pass, which stays ahead of the JSX transform and is
 * confined to `apply: "serve"` so the committed bundle never carries it.
 */
function locatorJsx(): Plugin {
  return {
    name: "nac:locator-jsx",
    apply: "serve",
    enforce: "pre",
    async transform(code, id) {
      const [file] = id.split("?");
      if (!file.endsWith(".tsx") && !file.endsWith(".jsx")) return null;
      if (file.includes("/node_modules/")) return null;

      const result = await transformAsync(code, {
        filename: file,
        babelrc: false,
        configFile: false,
        sourceMaps: true,
        // Only the Locator plugin runs here: TypeScript and JSX are parsed but
        // printed back untouched, leaving both transforms to Vite.
        parserOpts: { plugins: ["typescript", "jsx"] },
        plugins: ["@locator/babel-jsx/dist"],
      });
      if (!result?.code) return null;
      return { code: result.code, map: result.map };
    },
  };
}

export default defineConfig(({ command }) => ({
  // Only the built bundle lives under the embedded asset prefix; the dev server
  // owns its whole origin and proxies the API, so it serves from the root.
  base: command === "build" ? BASE : "/",
  plugins: [locatorJsx(), react(), tailwindcss()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: Object.fromEntries(
      API_PREFIXES.map((prefix) => [
        prefix,
        { target: API_TARGET, changeOrigin: true },
      ]),
    ),
  },
  build: {
    outDir: OUT_DIR,
    emptyOutDir: true,
    // The build output is committed so `cargo build` works without Node, and
    // sourcemaps would more than double what lands in git history.
    sourcemap: false,
  },
}));
