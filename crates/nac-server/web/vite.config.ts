import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// The bundle is emitted into the crate's `assets/` tree because the Rust server
// embeds that directory with `include_dir!` and serves it under `/assets/`.
// `base` has to match the serving prefix or hashed chunk URLs resolve to 404.
const OUT_DIR = path.resolve(__dirname, "../assets/dist");
const BASE = "/assets/dist/";

// Prefixes owned by the axum API router; everything else is frontend.
const API_PREFIXES = ["/health", "/store", "/sessions"];
const API_TARGET = process.env.NAC_API_URL ?? "http://127.0.0.1:3210";

export default defineConfig(({ command }) => ({
  // Only the built bundle lives under the embedded asset prefix; the dev server
  // owns its whole origin and proxies the API, so it serves from the root.
  base: command === "build" ? BASE : "/",
  plugins: [react()],
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
