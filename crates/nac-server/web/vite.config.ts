import fs from "node:fs";
import { createRequire } from "node:module";
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
  "/auth",
  "/credentials",
  "/fs",
  "/ssh",
  "/providers",
  "/model-configs",
  "/ssh-configs",
  "/models",
  "/commands",
  "/mcp_library",
];
const API_TARGET = process.env.NAC_API_URL ?? "http://127.0.0.1:3210";

// MathJax's CHTML output does not embed its glyphs; it emits `@font-face` rules
// pointing at a directory it is told about, so those fonts have to be served
// next to the bundle. They are copied out of the package at build time instead
// of being checked in a second time, and the version sits in the directory name
// because MathJax names the files itself: without it the immutable cache header
// the server sends for everything under `assets/` would pin an upgrade out.
const require_ = createRequire(import.meta.url);
const MATHJAX_MANIFEST = require_.resolve("mathjax-full/package.json");
const MATHJAX_VERSION = String(JSON.parse(fs.readFileSync(MATHJAX_MANIFEST, "utf8")).version);
const MATHJAX_FONT_SOURCE = path.join(
  path.dirname(MATHJAX_MANIFEST),
  "es5/output/chtml/fonts/woff-v2",
);
/** Where the fonts live, relative to both the bundle root and the dev origin. */
const MATHJAX_FONT_DIR = `assets/mathjax-${MATHJAX_VERSION}/fonts`;

function mathjaxFonts(): Plugin {
  return {
    name: "nac:mathjax-fonts",
    // Emitting them into the bundle is what gets them past `include_dir!` and
    // into the binary, same as every other asset the frontend needs.
    generateBundle() {
      for (const name of fs.readdirSync(MATHJAX_FONT_SOURCE)) {
        this.emitFile({
          type: "asset",
          fileName: `${MATHJAX_FONT_DIR}/${name}`,
          source: fs.readFileSync(path.join(MATHJAX_FONT_SOURCE, name)),
        });
      }
    },
    // The dev server answers the very same paths straight from the package.
    configureServer(server) {
      const prefix = `/${MATHJAX_FONT_DIR}/`;
      server.middlewares.use((request, response, next) => {
        const url = request.url ?? "";
        if (!url.startsWith(prefix)) return next();
        // `basename` keeps a crafted URL inside the font directory.
        const file = path.join(MATHJAX_FONT_SOURCE, path.basename(url.slice(prefix.length)));
        if (!fs.existsSync(file)) return next();
        response.setHeader("Content-Type", "font/woff");
        response.end(fs.readFileSync(file));
      });
    },
  };
}

/**
 * Marks every element with the source position Locator opens on Alt-click.
 *
 * React 19 dropped the fiber `_debugSource` that Locator's DevTools adapter
 * read, so these attributes are the only way left to resolve a rendered element
 * back to a file. The React plugin runs on oxc and no longer takes Babel
 * plugins, hence this pass, which stays ahead of the JSX transform and is
 * confined to `apply: "serve"` so the committed bundle never carries it.
 *
 * `cwd` is pinned to this package root so `projectPath` + `filePath` always
 * recombine to an absolute path, even when Vite is started from the monorepo
 * root via `npm --prefix`.
 *
 * `dataAttribute: "path"` embeds `file:line:column` on the element itself, so
 * links stay correct even if `window.__LOCATOR_DATA__` is briefly stale after
 * HMR.
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
        cwd: __dirname,
        babelrc: false,
        configFile: false,
        sourceMaps: true,
        // Only the Locator plugin runs here: TypeScript and JSX are parsed but
        // printed back untouched, leaving both transforms to Vite.
        parserOpts: { plugins: ["typescript", "jsx"] },
        plugins: [["@locator/babel-jsx/dist", { dataAttribute: "path" }]],
      });
      if (!result?.code) return null;
      return { code: result.code, map: result.map };
    },
  };
}

/**
 * Upstream Locator "Copy path" writes only `filePath` (no line/column), so
 * pasting into Cursor opens the file at the top. Rewrite that call to include
 * the absolute path and exact position.
 */
function locatorCopyWithLine(): Plugin {
  const needle = "navigator.clipboard.writeText(linkProps.filePath)";
  const replacement =
    "navigator.clipboard.writeText(`${linkProps.projectPath}${linkProps.filePath}:${linkProps.line}:${linkProps.column}`)";
  return {
    name: "nac:locator-copy-with-line",
    apply: "serve",
    enforce: "pre",
    transform(code, id) {
      if (!id.includes("@locator/runtime")) return null;
      if (!code.includes(needle)) return null;
      return { code: code.replaceAll(needle, replacement), map: null };
    },
  };
}

export default defineConfig(({ command }) => {
  // Only the built bundle lives under the embedded asset prefix; the dev server
  // owns its whole origin and proxies the API, so it serves from the root.
  const base = command === "build" ? BASE : "/";
  return {
    base,
    plugins: [locatorJsx(), locatorCopyWithLine(), react(), tailwindcss(), mathjaxFonts()],
    define: {
      __MATHJAX_FONT_URL__: JSON.stringify(base + MATHJAX_FONT_DIR),
      // MathJax reads its own version off disk with `eval('require')` unless a
      // bundler tells it what that version is, and in a browser that eval
      // throws while the module is still loading. Defining it is the hook
      // MathJax provides for exactly this, and it drops the dead branch too.
      PACKAGE_VERSION: JSON.stringify(MATHJAX_VERSION),
    },
    resolve: {
      alias: { "@": path.resolve(__dirname, "src") },
    },
    optimizeDeps: {
      // Keep Locator unbundled so `locatorCopyWithLine` can rewrite its
      // clipboard helper; esbuild prebundle would bake the upstream string in.
      exclude: ["@locator/runtime"],
      // Excluding a package also skips its dependency graph, and Locator reaches
      // a CJS semver through `@locator/shared`, which the browser then cannot
      // import by name. Prebundling that one dependency restores the interop.
      include: ["@locator/shared > semver"],
    },
    server: {
      port: 5173,
      strictPort: true,
      proxy: Object.fromEntries(
        API_PREFIXES.map((prefix) => [prefix, { target: API_TARGET, changeOrigin: true }]),
      ),
    },
    build: {
      outDir: OUT_DIR,
      emptyOutDir: true,
      // The build output is committed so `cargo build` works without Node, and
      // sourcemaps would more than double what lands in git history.
      sourcemap: false,
    },
  };
});
