import { isValidElement, memo, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";

import CodeBlock, { CodeBlockSize } from "@/app/atoms/code-block";
import { PerfProfiler } from "@/app/lib/PerfProfiler";
import { perfRender } from "@/app/lib/perfDebug";

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
function textOf(node: ReactNode): string {
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) {
    return textOf(node.props.children);
  }
  return "";
}

function languageOf(node: ReactNode): string {
  if (!isValidElement<{ className?: string; children?: ReactNode }>(node)) {
    return "plaintext";
  }
  const className = node.props.className ?? "";
  const match = /language-([\w+-]+)/.exec(className);
  if (match?.[1]) return match[1];
  return languageOf(node.props.children);
}

/**
 * Fenced block rendered as the design-system CodeBlock (header, copy,
 * fullscreen) — same chrome ArceeFM uses via CodeInput, with matching `my-6`.
 */
function CodeFence({ children }: { children?: ReactNode }) {
  const code = textOf(children).replace(/\n$/, "");
  const language = languageOf(children);
  return (
    <CodeBlock
      code={code}
      language={language === "plaintext" ? undefined : language}
      title={language}
      size={CodeBlockSize.Small}
      copyable
      expandable
      className="my-6"
    />
  );
}

function wrapStreaming(children: ReactNode, streaming: boolean): ReactNode {
  if (!streaming) return children;
  return <span className="streaming-chunk">{children}</span>;
}

interface MarkdownRendererProps {
  children: string;
  /** Fade newly painted prose while the turn is still streaming. */
  streaming?: boolean;
}

// react-markdown never injects raw HTML, so no sanitizer is needed; links still
// have to be neutered because the model controls their target.
function buildComponents(streaming: boolean) {
  return {
    a: ({ ...props }: React.ComponentPropsWithoutRef<"a">) => (
      <a {...props} target="_blank" rel="noopener noreferrer nofollow" />
    ),
    pre: ({ children }: { children?: ReactNode }) => (
      <CodeFence>{children}</CodeFence>
    ),
    table: ({ ...props }: React.ComponentPropsWithoutRef<"table">) => (
      <table {...props} />
    ),
    p: ({ children, ...props }: React.ComponentPropsWithoutRef<"p">) => (
      <p {...props}>{wrapStreaming(children, streaming)}</p>
    ),
    li: ({ children, ...props }: React.ComponentPropsWithoutRef<"li">) => (
      <li {...props}>{wrapStreaming(children, streaming)}</li>
    ),
    h1: ({ children, ...props }: React.ComponentPropsWithoutRef<"h1">) => (
      <h1 {...props}>{wrapStreaming(children, streaming)}</h1>
    ),
    h2: ({ children, ...props }: React.ComponentPropsWithoutRef<"h2">) => (
      <h2 {...props}>{wrapStreaming(children, streaming)}</h2>
    ),
    h3: ({ children, ...props }: React.ComponentPropsWithoutRef<"h3">) => (
      <h3 {...props}>{wrapStreaming(children, streaming)}</h3>
    ),
    h4: ({ children, ...props }: React.ComponentPropsWithoutRef<"h4">) => (
      <h4 {...props}>{wrapStreaming(children, streaming)}</h4>
    ),
    h5: ({ children, ...props }: React.ComponentPropsWithoutRef<"h5">) => (
      <h5 {...props}>{wrapStreaming(children, streaming)}</h5>
    ),
    h6: ({ children, ...props }: React.ComponentPropsWithoutRef<"h6">) => (
      <h6 {...props}>{wrapStreaming(children, streaming)}</h6>
    ),
  };
}

/**
 * Heavy half of the markdown support: the parser plus the syntax highlighter.
 * Always reach it through `lib/markdown`, which loads this chunk on demand.
 */
const MarkdownRenderer = memo(function MarkdownRenderer({
  children,
  streaming = false,
}: MarkdownRendererProps) {
  perfRender("Markdown");
  return (
    <PerfProfiler id="markdown">
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- plugin tuple types are not exported
        rehypePlugins={rehypePlugins as any}
        components={buildComponents(streaming)}
      >
        {children}
      </ReactMarkdown>
    </PerfProfiler>
  );
});

export default MarkdownRenderer;
