import { lazy, Suspense } from "react";

// The parser and the highlighter together outweigh the rest of the app, and
// nothing outside the inspector renders markdown, so they load on demand.
const MarkdownRenderer = lazy(() => import("./markdown-renderer"));

/** Markdown block used by transcript messages and thread episodes. */
export function Markdown({ children }: { children: string }) {
  return (
    <Suspense
      fallback={<pre className="whitespace-pre-wrap font-sans">{children}</pre>}
    >
      <MarkdownRenderer>{children}</MarkdownRenderer>
    </Suspense>
  );
}
