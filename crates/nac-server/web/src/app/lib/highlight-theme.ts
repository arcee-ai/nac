import type { ThemeRegistration } from "@shikijs/types";

// Placeholder hex values TextMate will accept. `colorReplacements` maps each
// one onto a nac CSS variable so light/dark follow the existing palette.

const PLACEHOLDER = {
  muted: "#000001",
  accent: "#000002",
  success: "#000003",
  danger: "#000004",
  info: "#000005",
  secondary: "#000006",
  error: "#000007",
  fg: "#000008",
} as const;

export const NAC_THEME_NAME = "nac";

export const nacColorReplacements: Record<string, string> = {
  [PLACEHOLDER.muted]: "var(--color-text-basic-muted)",
  [PLACEHOLDER.accent]: "var(--color-text-accent-primary)",
  [PLACEHOLDER.success]: "var(--color-text-success-primary)",
  [PLACEHOLDER.danger]: "var(--color-text-danger-primary)",
  [PLACEHOLDER.info]: "var(--color-text-info-primary)",
  [PLACEHOLDER.secondary]: "var(--color-text-basic-secondary)",
  [PLACEHOLDER.error]: "var(--color-text-error-primary)",
  [PLACEHOLDER.fg]: "var(--color-text-basic-primary)",
};

function colorRule(scope: string | string[], foreground: string, fontStyle?: string) {
  return {
    scope,
    settings: fontStyle ? { foreground, fontStyle } : { foreground },
  };
}

function styleRule(scope: string | string[], fontStyle: string) {
  return { scope, settings: { fontStyle } };
}

export const nacTheme: ThemeRegistration = {
  name: NAC_THEME_NAME,
  type: "dark",
  fg: PLACEHOLDER.fg,
  bg: "#000000",
  colorReplacements: nacColorReplacements,
  settings: [
    {
      settings: {
        foreground: PLACEHOLDER.fg,
        background: "#000000",
      },
    },
    colorRule(["comment", "punctuation.definition.comment"], PLACEHOLDER.muted, "italic"),
    colorRule(
      ["keyword", "storage", "storage.type", "support.type", "entity.name.type", "entity.name.tag"],
      PLACEHOLDER.accent,
    ),
    colorRule(["string", "string.regexp", "markup.inserted"], PLACEHOLDER.success),
    colorRule(
      ["constant.numeric", "constant.language", "constant.character", "markup.list"],
      PLACEHOLDER.danger,
    ),
    colorRule(
      [
        "entity.name.function",
        "support.function",
        "entity.name.section",
        "entity.name.class",
        "entity.name.type.class",
      ],
      PLACEHOLDER.info,
    ),
    colorRule(["variable", "entity.other.attribute-name"], PLACEHOLDER.secondary),
    colorRule("markup.deleted", PLACEHOLDER.error),
    styleRule(["markup.italic", "markup.quote"], "italic"),
    styleRule("markup.bold", "bold"),
  ],
};
