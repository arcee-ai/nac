// Syntax colouring for the diff viewer.
//
// A diff is not a file, so highlighting it line by line mis-tokenises anything
// that spans lines: block comments, template literals, JSX. Instead each hunk
// is highlighted as two contiguous documents — the old side (context plus
// deletions) and the new side (context plus insertions) — which are real
// slices of real files, and the tokens are then cut back into lines. A hunk
// starting inside a block comment still gets it wrong, because it cannot see
// what came before, but that only costs colours: every path here falls back to
// plain text rather than risk showing altered code.

import type { WorkspaceDiffLine, WorkspaceDiffSection } from "@/app/types/api";

export interface CodeToken {
  text: string;
  /** highlight.js class chain, styled by the theme in `theme/markdown.css`. */
  className: string | null;
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
  htm: "xml",
  html: "xml",
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
  toml: "ini",
  ts: "typescript",
  tsx: "typescript",
  xml: "xml",
  yaml: "yaml",
  yml: "yaml",
  zsh: "bash",
};

/** highlight.js language for a path, or null when we should not guess. */
export function languageFromPath(path: string): string | null {
  const name = path.replace(/\/+$/, "").split("/").pop() ?? "";
  const extension = name.includes(".") ? name.split(".").pop() : "";
  return LANGUAGE_BY_EXTENSION[(extension ?? "").toLowerCase()] ?? null;
}

// Minimal shape of the hast tree lowlight returns; the full types are not
// worth pulling in for a two-case walk.
interface HastText {
  type: "text";
  value: string;
}
interface HastElement {
  type: "element";
  properties?: { className?: unknown };
  children: HastNode[];
}
type HastNode = HastText | HastElement | { type: string };

type Lowlight = {
  registered: (language: string) => boolean;
  highlight: (language: string, value: string) => { children: HastNode[] };
};

let lowlightPromise: Promise<Lowlight> | null = null;

// Shared with the markdown renderer, so this pulls in no extra bundle weight
// beyond what a session with any code block already loads.
function loadLowlight(): Promise<Lowlight> {
  lowlightPromise ??= import("lowlight").then(({ common, createLowlight }) =>
    createLowlight(common),
  );
  return lowlightPromise;
}

function flatten(nodes: HastNode[], inherited: string | null, out: CodeToken[]) {
  for (const node of nodes) {
    if (node.type === "text") {
      // SAFETY: the hast node's type field was just matched, so the text
      // variant's value property is present.
      out.push({ text: (node as HastText).value, className: inherited });
      continue;
    }
    if (node.type !== "element") continue;
    // SAFETY: the hast node's type field was just matched, so the element
    // variant's properties and children are present.
    const element = node as HastElement;
    const own = element.properties?.className;
    const names = Array.isArray(own) ? own.join(" ") : "";
    const className = [inherited, names].filter(Boolean).join(" ") || null;
    flatten(element.children, className, out);
  }
}

function splitLines(tokens: CodeToken[]): CodeToken[][] {
  const lines: CodeToken[][] = [[]];
  for (const token of tokens) {
    const parts = token.text.split("\n");
    parts.forEach((part, index) => {
      if (index > 0) lines.push([]);
      if (part) lines[lines.length - 1].push({ text: part, className: token.className });
    });
  }
  return lines;
}

/** Tokens per line, or null when the result would not reproduce the input. */
async function highlightBlock(
  language: string,
  text: string,
): Promise<CodeToken[][] | null> {
  const lowlight = await loadLowlight();
  if (!lowlight.registered(language)) return null;

  let tokens: CodeToken[];
  try {
    const tree = lowlight.highlight(language, text);
    tokens = [];
    flatten(tree.children, null, tokens);
  } catch {
    return null;
  }

  // The guard that makes this safe: colour the code only if the tokens spell
  // out exactly what went in.
  if (tokens.map((token) => token.text).join("") !== text) return null;
  return splitLines(tokens);
}

/**
 * Tokens per line for a snippet whose language is already known, for callers
 * that have a language name rather than a path.
 */
export async function highlightSource(
  language: string,
  text: string,
): Promise<CodeToken[][] | null> {
  return highlightBlock(language, text);
}

/**
 * Tokens per line for a whole file. Unlike a diff this is a real document, so
 * the tokenizer sees everything it needs and only an unknown language or the
 * integrity check above can turn the colours off.
 */
export async function highlightCode(
  path: string,
  text: string,
): Promise<CodeToken[][] | null> {
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
        const tokens = await highlightBlock(
          language,
          lines.map((line) => line.content).join("\n"),
        );
        if (!tokens || tokens.length !== lines.length) continue;
        lines.forEach((line, index) => highlighted.set(line, tokens[index]));
      }
    }
  }

  return highlighted;
}
