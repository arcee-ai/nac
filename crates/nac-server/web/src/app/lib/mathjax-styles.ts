/** Split CSSOM selector lists without breaking quoted attributes or :is()/ :not(). */
function selectors(value: string): string[] {
  const result: string[] = [];
  let start = 0,
    depth = 0,
    quote = "",
    escaped = false;
  for (let index = 0; index < value.length; index++) {
    const character = value[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (character === quote) quote = "";
      continue;
    }
    if (character === '"' || character === "'") quote = character;
    else if (character === "(" || character === "[") depth++;
    else if (character === ")" || character === "]") depth--;
    else if (character === "," && depth === 0) {
      result.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  result.push(value.slice(start).trim());
  return result;
}

/**
 * MathJax owns this generated sheet. Prefix every style rule instead of using
 * @scope, which is newer than the consumer's existing browser build targets.
 * The legacy CSSOM parser is inert (media=not all), local and removed in finally.
 */
export function scopeMathjaxStyles(css: string, instance: number, portal: HTMLElement): string {
  const parser = portal.ownerDocument.createElement("style");
  parser.media = "not all";
  parser.textContent = css;
  portal.append(parser);
  try {
    if (!parser.sheet || !parser.sheet.cssRules.length)
      throw new Error("Cannot parse the generated native formula stylesheet.");
    const boundary = `[data-nac-runtime="${instance}"]`;
    function declarations(style: CSSStyleDeclaration): string {
      const family = style.getPropertyValue("font-family");
      if (family)
        style.setProperty(
          "font-family",
          family.replace(/\bMJX[\w-]*/g, (name) => `NAC${instance}${name}`),
          style.getPropertyPriority("font-family"),
        );
      return style.cssText;
    }
    function scope(rules: CSSRuleList): string {
      return Array.from(rules, (rule) => {
        if (rule.type === 1) {
          const style = rule as CSSStyleRule;
          return (
            selectors(style.selectorText)
              .map((selector) => `${boundary} ${selector}`)
              .join(", ") + `{${declarations(style.style)}}`
          );
        }
        // Font registrations are document-wide; namespace their family, keeping URLs intact.
        if (rule.type === 5) return `@font-face{${declarations((rule as CSSFontFaceRule).style)}}`;
        if (rule.type === 4 || rule.type === 12) {
          const group = rule as CSSMediaRule | CSSSupportsRule;
          return `${rule.type === 4 ? "@media" : "@supports"} ${group.conditionText}{${scope(group.cssRules)}}`;
        }
        throw new Error("Unsupported rule in the generated native formula stylesheet.");
      }).join("\n");
    }
    return scope(parser.sheet.cssRules);
  } finally {
    parser.remove();
  }
}
