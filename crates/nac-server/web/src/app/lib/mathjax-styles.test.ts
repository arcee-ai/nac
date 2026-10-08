/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import { scopeMathjaxStyles } from "./mathjax-styles";

describe("generated formula stylesheet locality on legacy CSSOM", () => {
  it("prefixes complex selector lists, grouping rules and font families without @scope", () => {
    const portal = document.createElement("div");
    document.body.append(portal);
    const sheets = document.styleSheets.length;
    try {
      const css = scopeMathjaxStyles(
        `
        mjx-container:not([data-label="a,b"]), mjx-mi:is(.a,.b) { font-family: MJXTEX; line-height: 0; }
        @font-face { font-family: MJXTEX; src: url(/caller/MJXTEX/math.woff); }
        @media print { mjx-mi { color: black; } }
      `,
        42,
        portal,
      );
      expect(css).not.toContain("@scope");
      expect(css).toContain('[data-nac-runtime="42"] mjx-container:not([data-label="a,b"])');
      expect(css).toContain('[data-nac-runtime="42"] mjx-mi:is(.a,.b)');
      expect(css).toContain("font-family: NAC42MJXTEX");
      expect(css).toContain("url(/caller/MJXTEX/math.woff)");
      expect(css).toContain('@media print{[data-nac-runtime="42"] mjx-mi');
      expect(portal.querySelector("style")).toBeNull();
      expect(document.styleSheets.length).toBe(sheets);
    } finally {
      portal.remove();
    }
  });

  it("removes the inert parser and fails closed for unsupported generated rules", () => {
    const portal = document.createElement("div");
    document.body.append(portal);
    try {
      expect(() =>
        scopeMathjaxStyles("@keyframes foreign { to { opacity: 0 } }", 9, portal),
      ).toThrow("Unsupported rule");
      expect(portal.querySelector("style")).toBeNull();
    } finally {
      portal.remove();
    }
  });
});
