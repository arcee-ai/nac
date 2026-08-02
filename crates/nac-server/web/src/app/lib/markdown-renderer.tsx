import { isValidElement, memo } from "react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";

import CopyButton from "@/app/atoms/button/CopyButton";
import { AnchorPlacement } from "@/app/lib/anchor";

import bash from "highlight.js/lib/languages/bash";
import css from "highlight.js/lib/languages/css";
import diff from "highlight.js/lib/languages/diff";
import go from "highlight.js/lib/languages/go";
import json from "highlight.js/lib/languages/json";
import markdown from "highlight.js/lib/languages/markdown";
import python from "highlight.js/lib/languages/python";
import rust from "highlight.js/lib/languages/rust";
import sql from "highlight.js/lib/languages/sql";
import toml from "highlight.js/lib/languages/ini";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";

// Only the languages an agent transcript realistically contains; the full
// highlight.js bundle would dwarf the rest of the app.
const languages = {
  bash,
  css,
  diff,
  go,
  json,
  markdown,
  python,
  rust,
  sql,
  toml,
  typescript,
  xml,
  yaml,
};

const remarkPlugins = [remarkGfm];
const rehypePlugins = [
  [rehypeHighlight, { languages, detect: true, ignoreMissing: true }] as const,
];

/** Text of a fenced block, for the clipboard. Nested spans carry the tokens. */
function textOf(node: React.ReactNode): string {
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement<{ children?: React.ReactNode }>(node)) {
    return textOf(node.props.children);
  }
  return "";
}

/**
 * Fenced block with a copy affordance that only appears on hover, so a long
 * transcript is not littered with buttons.
 */
function CodeFence({ children, ...props }: React.ComponentPropsWithoutRef<"pre">) {
  return (
    <div className="group relative">
      <pre {...props}>{children}</pre>
      <CopyButton
        value={textOf(children)}
        title="Copy code"
        position={AnchorPlacement.BottomLeft}
        className="absolute top-2 right-2 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
      />
    </div>
  );
}

// react-markdown never injects raw HTML, so no sanitizer is needed; links still
// have to be neutered because the model controls their target.
const components = {
  a: ({ ...props }: React.ComponentPropsWithoutRef<"a">) => (
    <a {...props} target="_blank" rel="noopener noreferrer nofollow" />
  ),
  pre: CodeFence,
};

/**
 * Heavy half of the markdown support: the parser plus the syntax highlighter.
 * Always reach it through `lib/markdown`, which loads this chunk on demand.
 */
const MarkdownRenderer = memo(function MarkdownRenderer({
  children,
}: {
  children: string;
}) {
  return (
    <ReactMarkdown
      remarkPlugins={remarkPlugins}
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- plugin tuple types are not exported
      rehypePlugins={rehypePlugins as any}
      components={components}
    >
      {children}
    </ReactMarkdown>
  );
});

export default MarkdownRenderer;
