import { memo } from "react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";

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

// react-markdown never injects raw HTML, so no sanitizer is needed; links still
// have to be neutered because the model controls their target.
const components = {
  a: ({ ...props }: React.ComponentPropsWithoutRef<"a">) => (
    <a {...props} target="_blank" rel="noopener noreferrer nofollow" />
  ),
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
