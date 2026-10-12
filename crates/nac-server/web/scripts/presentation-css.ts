import postcss, { type Container, type Document } from "postcss";
import selectorParser from "postcss-selector-parser";

const boundary = "[data-nac-runtime]";
const fonts = new Map([
  ["Inter", "NACPresentationInter"],
  ["IBMPlexMono", "NACPresentationMono"],
  ["Asap", "NACPresentationAsap"],
]);

/** Scope the existing generated design system; never create a second theme writer. */
export function scopePresentationCss(css: string): string {
  const root = postcss.parse(css);
  const keyframes = new Map<string, string>();
  root.walkAtRules(/keyframes$/, (rule) => {
    keyframes.set(rule.params, `nac-presentation-${rule.params}`);
    rule.params = keyframes.get(rule.params)!;
  });
  // A consumer's layer order cannot reorder the native design system, or vice versa.
  root.walkAtRules("layer", (rule) => {
    if (rule.nodes) rule.replaceWith(rule.nodes);
    else rule.remove();
  });
  root.walkRules((rule) => {
    let parent: Container | Document | undefined = rule.parent;
    while (parent) {
      if (parent.type === "rule") return;
      if (parent.type === "atrule" && "name" in parent && String(parent.name).endsWith("keyframes"))
        return;
      parent = parent.parent;
    }
    rule.selectors = rule.selectors.flatMap((selector) => {
      const local = selectorParser((selectors) => {
        selectors.walk((node) => {
          if (
            (node.type === "tag" && ["html", "body"].includes(node.value)) ||
            (node.type === "pseudo" && [":root", ":host"].includes(node.value)) ||
            (node.type === "id" && node.value === "root")
          )
            node.replaceWith(
              selectorParser.attribute({
                attribute: "data-nac-runtime",
                value: undefined,
                raws: {},
              }),
            );
        });
      }).processSync(selector);
      if (local.includes(boundary)) return [local];
      // Pseudo-elements cannot appear inside :is(). Both the root and its
      // descendants need preflight; all other selectors match either position.
      if (local.startsWith("::")) return [`${boundary}${local}`, `${boundary} ${local}`];
      if (local.includes("::")) return [`${boundary} ${local}`];
      return [`${boundary}:is(${local})`, `${boundary} ${local}`];
    });
  });
  root.walkDecls((declaration) => {
    if (declaration.prop.endsWith("font-family") || declaration.prop.startsWith("--font-")) {
      for (const [font, scoped] of fonts) {
        declaration.value = declaration.value.replace(new RegExp(`\\b${font}\\b`, "g"), scoped);
      }
    }
    if (
      declaration.prop === "animation" ||
      declaration.prop === "animation-name" ||
      declaration.prop.startsWith("--animate-")
    ) {
      for (const [name, scoped] of keyframes) {
        declaration.value = declaration.value.replace(
          new RegExp(`(?<![\\w-])${name}(?![\\w-])`, "g"),
          scoped,
        );
      }
    }
  });
  // Tailwind's property registrations are document-wide, so give this build
  // its own registrations and references instead of modifying caller ones.
  return root.toString().replaceAll("--tw-", "--nac-presentation-tw-");
}
