import { describe, expect, it } from "vitest";
import postcss from "postcss";
import { scopePresentationCss } from "./scripts/presentation-css";

describe("packed presentation stylesheet boundary", () => {
  it("preserves escaped utility names and anchors nested selectors once", () => {
    const css = String.raw`@layer utilities {
      .\[\.light_\&\]\:bg-gradient-to-t { .light & { color: red; } }
      .body-text { color: blue; }
      body, :root, #root { --brand-500: teal; }
    }`;
    const output = scopePresentationCss(css);
    const rules: string[] = [];
    postcss.parse(output).walkRules((rule) => {
      rules.push(rule.selector);
    });
    expect(rules[0]).toContain(String.raw`.\[\.light_\&\]\:bg-gradient-to-t`);
    expect(rules[1]).toBe(".light &");
    expect(rules[2]).toContain(".body-text");
    expect(rules[3]).toBe("[data-nac-runtime], [data-nac-runtime], [data-nac-runtime]");
    expect(output).not.toContain("@layer");
  });

  it("namespaces document-wide font, animation and property registrations", () => {
    const output = scopePresentationCss(`
      @font-face { font-family: Inter; src: url(inter.woff2); }
      @property --tw-opacity { syntax: "<number>"; initial-value: 1; inherits: false; }
      @keyframes fade { to { opacity: 0; } }
      .btn { font-family: Inter, sans-serif; animation: fade 1s; opacity: var(--tw-opacity); }
    `);
    expect(output).toContain("font-family: NACPresentationInter");
    expect(output).toContain("@property --nac-presentation-tw-opacity");
    expect(output).toContain("@keyframes nac-presentation-fade");
    expect(output).toContain("animation: nac-presentation-fade 1s");
    expect(output).toContain("[data-nac-runtime] .btn");
    expect(output).toContain("to { opacity: 0; }");
    expect(output).not.toContain("[data-nac-runtime] to");
  });
});
