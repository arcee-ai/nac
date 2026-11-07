import { describe, expect, it } from "vitest";
import { inspectExports, inspectManifest } from "./presentation-artifact.mjs";
import packageDefinition from "../../../../package.json";

const prefix = "crates/nac-server/web/packages/nac-presentation/dist/";
const font = "assets/mathjax-3/fonts/MathJax_Main-Regular.woff";
const icon = "assets/icon.svg";
const manifest = { assets: [font, icon], mathjaxFonts: [font] };

describe("packed presentation inventory", () => {
  it("requires the actual font and asset payloads, not only manifest entries", () => {
    expect(() => inspectManifest(manifest, [prefix + font, prefix + icon])).not.toThrow();
    expect(() => inspectManifest(manifest, [prefix + icon])).toThrow(/asset missing/);
    expect(() =>
      inspectManifest(manifest, [prefix + font, prefix + icon, prefix + "assets/extra.svg"]),
    ).toThrow(/unlisted packed asset/);
  });

  it("rejects host paths and traversal before a consumer copies assets", () => {
    for (const asset of [
      "/host/font.woff",
      "assets/../outside.woff",
      "assets//font.woff",
      "assets/a\\b.woff",
    ])
      expect(() =>
        inspectManifest({ assets: [asset], mathjaxFonts: [asset] }, [prefix + asset]),
      ).toThrow();
  });

  it("requires fonts to be included in the finite asset inventory", () => {
    expect(() =>
      inspectManifest({ assets: [icon], mathjaxFonts: [font] }, [prefix + icon]),
    ).toThrow(/font missing/);
  });

  it("fails when a public export is absent even if assets are complete", () => {
    const exports = packageDefinition.exports;
    const files = Object.values(exports)
      .flatMap((entry) => (typeof entry === "string" ? [entry] : Object.values(entry)))
      .map((entry) => entry.slice(2).replace("*", "fixture.svg"));
    expect(() => inspectExports(exports, files)).not.toThrow();
    expect(() =>
      inspectExports(
        exports,
        files.filter((entry) => !entry.endsWith("/index.d.ts")),
      ),
    ).toThrow(/export missing/);
    const withoutCss = Object.fromEntries(
      Object.entries(exports).filter(([key]) => key !== "./presentation/styles.css"),
    );
    expect(() => inspectExports(withoutCss, files)).toThrow(/missing public export/);
  });
});
