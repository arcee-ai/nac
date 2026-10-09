import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, mergeConfig, type Plugin } from "vite";
import nativeConfiguration from "./vite.config";
import { scopePresentationCss } from "./scripts/presentation-css";

const web = path.dirname(fileURLToPath(import.meta.url));
const peers = [
  "react",
  "react-dom",
  "react-router",
  "react-router-dom",
  "@tanstack/react-query",
  "@tanstack/query-core",
];

function presentationOutput(): Plugin {
  return {
    name: "nac:presentation-output",
    generateBundle(_options, bundle) {
      for (const output of Object.values(bundle)) {
        if (output.type === "chunk") output.code = output.code.replace(/[\t ]+$/gm, "");
      }
      const assets = Object.values(bundle)
        .filter((output) => output.type === "asset" && output.fileName.startsWith("assets/"))
        .map((output) => output.fileName)
        .sort();
      this.emitFile({
        type: "asset",
        fileName: "assets.json",
        source:
          JSON.stringify(
            { assets, mathjaxFonts: assets.filter((name) => name.includes("/fonts/")) },
            null,
            2,
          ) + "\n",
      });
    },
    writeBundle(options) {
      const stylesheet = options.dir && path.join(options.dir, "styles.css");
      if (!stylesheet || !fs.existsSync(stylesheet))
        throw new Error("Missing explicit presentation stylesheet");
      // Vite emits extracted CSS after its generateBundle hooks. Apply the
      // owned scope transform once to the final stylesheet before packing.
      fs.writeFileSync(stylesheet, scopePresentationCss(fs.readFileSync(stylesheet, "utf8")));
    },
  };
}

export default defineConfig(async (environment) => {
  const native =
    typeof nativeConfiguration === "function"
      ? await nativeConfiguration(environment)
      : nativeConfiguration;
  return mergeConfig(native, {
    base: "./",
    publicDir: false,
    plugins: [presentationOutput()],
    // A packed consumer supplies this URL through the instance's assets option.
    define: { __MATHJAX_FONT_URL__: JSON.stringify("") },
    build: {
      outDir: path.join(web, "packages/nac-presentation/dist"),
      cssMinify: false,
      lib: {
        entry: path.join(web, "packages/nac-presentation/entry.ts"),
        formats: ["es"],
        fileName: "index",
        cssFileName: "styles",
      },
      rollupOptions: {
        external: (id: string) => peers.some((peer) => id === peer || id.startsWith(peer + "/")),
        output: { chunkFileNames: "chunks/[name]-[hash].js" },
      },
    },
  });
});
