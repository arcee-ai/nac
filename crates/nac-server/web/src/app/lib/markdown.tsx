import { lazy, Suspense } from "react";

import { cn } from "@/app/lib/cn";
import { loadMarkdownRenderer } from "@/app/lib/markdownChunk";

const MarkdownRenderer = lazy(loadMarkdownRenderer);

interface MarkdownProps {
  children: string;
  /** Fade newly painted prose while the turn is still streaming. */
  streaming?: boolean;
  className?: string;
}

/** Markdown block used by transcript messages and thread episodes. */
export function Markdown({ children, streaming = false, className }: MarkdownProps) {
  return (
    <div
      className={cn(
        // `chat-response` is the shared prose skin (same as model replies).
        "chat-response markdown markdown-content text-basic-primary w-full",
        streaming && "streaming",
        className,
      )}
    >
      <Suspense fallback={<pre className="whitespace-pre-wrap font-sans">{children}</pre>}>
        <MarkdownRenderer streaming={streaming}>{children}</MarkdownRenderer>
      </Suspense>
    </div>
  );
}
