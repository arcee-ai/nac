// Syntax colouring for the diff viewer, file pane, and fenced code blocks.
//
// A diff is not a file, so highlighting it line by line mis-tokenises anything
// that spans lines: block comments, template literals, JSX. Instead each hunk
// is highlighted as two contiguous documents — the old side (context plus
// deletions) and the new side (context plus insertions) — which are real
// slices of real files, and the tokens are then cut back into lines. A hunk
// starting inside a block comment still gets it wrong, because it cannot see
// what came before, but that only costs colours: every path here falls back to
// plain text rather than risk showing altered code.

import type { HighlighterCore, LanguageRegistration, ThemedToken } from "shiki/core";

import type { WorkspaceDiffLine, WorkspaceDiffSection } from "@/app/types/api";

import { NAC_THEME_NAME, nacColorReplacements, nacTheme } from "./highlight-theme";

export interface CodeToken {
  text: string;
  /** CSS color, typically a `var(--color-…)` from the nac theme. */
  color: string | null;
  italic?: boolean;
  bold?: boolean;
}

export interface CodeTokenStyle {
  color?: string;
  fontStyle?: "italic";
  fontWeight?: 600;
}

/** Inline style for a highlighted span. */
export function tokenStyle(token: CodeToken): CodeTokenStyle {
  return {
    color: token.color ?? undefined,
    fontStyle: token.italic ? "italic" : undefined,
    fontWeight: token.bold ? 600 : undefined,
  };
}

interface LanguageByExtensionMap {
  [extension: string]: string;
}

const LANGUAGE_BY_EXTENSION: LanguageByExtensionMap = {
  bash: "bash",
  c: "c",
  cc: "cpp",
  cjs: "javascript",
  cpp: "cpp",
  cs: "csharp",
  css: "css",
  cts: "typescript",
  go: "go",
  h: "c",
  hpp: "cpp",
  htm: "html",
  html: "html",
  ini: "ini",
  java: "java",
  js: "javascript",
  json: "json",
  jsx: "javascript",
  kt: "kotlin",
  less: "less",
  markdown: "markdown",
  md: "markdown",
  mjs: "javascript",
  mts: "typescript",
  php: "php",
  py: "python",
  rb: "ruby",
  rs: "rust",
  scss: "scss",
  sh: "bash",
  sql: "sql",
  svg: "xml",
  swift: "swift",
  toml: "toml",
  ts: "typescript",
  tsx: "typescript",
  xml: "xml",
  yaml: "yaml",
  yml: "yaml",
  zsh: "bash",
};

// Fence info strings models emit that are not already Shiki grammar ids.
const LANGUAGE_ALIASES: Record<string, string> = {
  cc: "cpp",
  cjs: "javascript",
  cs: "csharp",
  cts: "typescript",
  h: "c",
  hpp: "cpp",
  htm: "html",
  js: "javascript",
  kt: "kotlin",
  md: "markdown",
  mjs: "javascript",
  mts: "typescript",
  py: "python",
  rb: "ruby",
  rs: "rust",
  sh: "bash",
  shell: "bash",
  svg: "xml",
  ts: "typescript",
  yml: "yaml",
  zsh: "bash",
};

const PLAIN_LANGUAGE_NAMES = new Set(["plain", "plaintext", "text", "txt"]);

// vscode-textmate FontStyle bits. Italic/bold are the only ones the theme sets.
const FONT_ITALIC = 1;
const FONT_BOLD = 2;

const TOKEN_CACHE_LIMIT = 50;
const tokenCache = new Map<string, CodeToken[][] | null>();

type GrammarModule = { default: LanguageRegistration | LanguageRegistration[] };

const GRAMMAR_LOADERS: Record<string, () => Promise<GrammarModule>> = {
  bash: () => import("@shikijs/langs/bash"),
  c: () => import("@shikijs/langs/c"),
  cpp: () => import("@shikijs/langs/cpp"),
  csharp: () => import("@shikijs/langs/csharp"),
  css: () => import("@shikijs/langs/css"),
  diff: () => import("@shikijs/langs/diff"),
  go: () => import("@shikijs/langs/go"),
  html: () => import("@shikijs/langs/html"),
  ini: () => import("@shikijs/langs/ini"),
  java: () => import("@shikijs/langs/java"),
  javascript: () => import("@shikijs/langs/javascript"),
  json: () => import("@shikijs/langs/json"),
  jsonc: () => import("@shikijs/langs/jsonc"),
  jsx: () => import("@shikijs/langs/jsx"),
  kotlin: () => import("@shikijs/langs/kotlin"),
  less: () => import("@shikijs/langs/less"),
  markdown: () => import("@shikijs/langs/markdown"),
  php: () => import("@shikijs/langs/php"),
  python: () => import("@shikijs/langs/python"),
  ruby: () => import("@shikijs/langs/ruby"),
  rust: () => import("@shikijs/langs/rust"),
  scss: () => import("@shikijs/langs/scss"),
  sql: () => import("@shikijs/langs/sql"),
  swift: () => import("@shikijs/langs/swift"),
  toml: () => import("@shikijs/langs/toml"),
  tsx: () => import("@shikijs/langs/tsx"),
  typescript: () => import("@shikijs/langs/typescript"),
  xml: () => import("@shikijs/langs/xml"),
  yaml: () => import("@shikijs/langs/yaml"),
};

let highlighterPromise: Promise<HighlighterCore> | null = null;
const languageLoads = new Map<string, Promise<boolean>>();

/** Shiki language id for a path, or null when we should not guess. */
export function languageFromPath(path: string): string | null {
  const name = path.replace(/\/+$/, "").split("/").pop() ?? "";
  const extension = name.includes(".") ? name.split(".").pop() : "";
  return LANGUAGE_BY_EXTENSION[(extension ?? "").toLowerCase()] ?? null;
}

function resolveLanguage(language: string): string | null {
  const name = language.trim().toLowerCase();
  if (!name || PLAIN_LANGUAGE_NAMES.has(name)) return null;
  const aliased = LANGUAGE_ALIASES[name] ?? name;
  if (aliased in GRAMMAR_LOADERS) return aliased;
  return null;
}

function loadHighlighter(): Promise<HighlighterCore> {
  highlighterPromise ??= (async () => {
    const [{ createHighlighterCore }, { createJavaScriptRegexEngine }] = await Promise.all([
      import("shiki/core"),
      import("shiki/engine/javascript"),
    ]);
    return createHighlighterCore({
      themes: [nacTheme],
      langs: [],
      engine: createJavaScriptRegexEngine(),
    });
  })();
  return highlighterPromise;
}

async function loadLanguage(id: string): Promise<boolean> {
  const loader = GRAMMAR_LOADERS[id];
  if (!loader) return false;
  try {
    const highlighter = await loadHighlighter();
    if (highlighter.getLoadedLanguages().includes(id)) return true;
    await highlighter.loadLanguage(loader());
    return highlighter.getLoadedLanguages().includes(id);
  } catch {
    return false;
  }
}

function ensureLanguage(id: string): Promise<boolean> {
  let pending = languageLoads.get(id);
  if (!pending) {
    pending = loadLanguage(id);
    languageLoads.set(id, pending);
  }
  return pending;
}

function toCodeToken(token: ThemedToken): CodeToken {
  const fontStyle = token.fontStyle ?? 0;
  const mapped: CodeToken = {
    text: token.content,
    color: token.color || null,
  };
  if (fontStyle & FONT_ITALIC) mapped.italic = true;
  if (fontStyle & FONT_BOLD) mapped.bold = true;
  return mapped;
}

function toCodeLines(tokensPerLine: ThemedToken[][]): CodeToken[][] {
  return tokensPerLine.map((line) => line.map(toCodeToken));
}

function reconstructed(lines: CodeToken[][]): string {
  return lines.map((line) => line.map((token) => token.text).join("")).join("\n");
}

function cacheKey(language: string, text: string): string {
  return `${language}\0${text}`;
}

function readCache(key: string): CodeToken[][] | null | undefined {
  if (!tokenCache.has(key)) return undefined;
  const value = tokenCache.get(key) ?? null;
  tokenCache.delete(key);
  tokenCache.set(key, value);
  return value;
}

function writeCache(key: string, value: CodeToken[][] | null): void {
  tokenCache.set(key, value);
  if (tokenCache.size <= TOKEN_CACHE_LIMIT) return;
  const oldest = tokenCache.keys().next().value;
  if (oldest !== undefined) tokenCache.delete(oldest);
}

/** Tokens per line, or null when the language is unknown or tokenising fails. */
async function highlightBlock(language: string, text: string): Promise<CodeToken[][] | null> {
  const key = cacheKey(language, text);
  const cached = readCache(key);
  if (cached !== undefined) return cached;

  const loaded = await ensureLanguage(language);
  if (!loaded) {
    writeCache(key, null);
    return null;
  }

  let lines: CodeToken[][];
  try {
    const highlighter = await loadHighlighter();
    const tokensPerLine = highlighter.codeToTokensBase(text, {
      lang: language,
      theme: NAC_THEME_NAME,
      colorReplacements: nacColorReplacements,
    });
    lines = toCodeLines(tokensPerLine);
  } catch {
    writeCache(key, null);
    return null;
  }

  // Colour the code only if the tokens spell out exactly what went in.
  if (reconstructed(lines) !== text) {
    writeCache(key, null);
    return null;
  }

  writeCache(key, lines);
  return lines;
}

/**
 * Tokens per line for a snippet whose language is already known, for callers
 * that have a language name rather than a path.
 */
export async function highlightSource(
  language: string,
  text: string,
): Promise<CodeToken[][] | null> {
  const resolved = resolveLanguage(language);
  if (!resolved) return null;
  return highlightBlock(resolved, text);
}

/**
 * Tokens per line for a whole file. Unlike a diff this is a real document, so
 * the tokenizer sees everything it needs and only an unknown language turns
 * the colours off.
 */
export async function highlightCode(path: string, text: string): Promise<CodeToken[][] | null> {
  const language = languageFromPath(path);
  if (!language) return null;
  return highlightBlock(language, text);
}

const OLD_SIDE = new Set(["delete", "context"]);
const NEW_SIDE = new Set(["insert", "context"]);

/**
 * Highlight every hunk of a file diff. Keyed by line object, so a caller can
 * look each rendered row up and fall back to plain text when it is missing.
 */
export async function highlightDiff(
  path: string,
  sections: WorkspaceDiffSection[],
): Promise<Map<WorkspaceDiffLine, CodeToken[]>> {
  const highlighted = new Map<WorkspaceDiffLine, CodeToken[]>();
  const language = languageFromPath(path);
  if (!language) return highlighted;

  for (const section of sections) {
    for (const hunk of section.hunks) {
      for (const side of [OLD_SIDE, NEW_SIDE]) {
        const lines = hunk.lines.filter((line) => side.has(line.kind));
        if (lines.length === 0) continue;
        const tokens = await highlightBlock(language, lines.map((line) => line.content).join("\n"));
        if (!tokens || tokens.length !== lines.length) continue;
        lines.forEach((line, index) => highlighted.set(line, tokens[index]));
      }
    }
  }

  return highlighted;
}
