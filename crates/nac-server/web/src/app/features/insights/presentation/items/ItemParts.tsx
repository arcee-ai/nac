import { useState, type ReactNode } from "react";

import { InsightLinkButton } from "@/app/atoms";
import type { ItemContext } from "@/app/features/insights/presentation/items/itemContent";
import type { SessionLink } from "@/app/features/insights/presentation/useDelegatedSessions";
import { Markdown } from "@/app/lib/markdown";

/** Reasoning has no bound of its own, unlike the backend's tool previews. */
const TAIL_LINES = 200;

export function BodyText({ children }: { children: ReactNode }) {
  return <p className="whitespace-pre-wrap break-words">{children}</p>;
}

export function SuccessText({ children }: { children: ReactNode }) {
  return <p className="text-small text-success-primary">{children}</p>;
}

/** Rendered only for a session the delegation records confirm. */
export function SessionLinkButton({
  link,
  context,
}: {
  link: SessionLink | null;
  context: ItemContext;
}) {
  if (!link) return null;
  return (
    <InsightLinkButton
      label={link.title || "Open session"}
      onClick={() => context.openSubagent(link.rowKey)}
    />
  );
}

export function ReasoningText({ text, streaming }: { text: string; streaming: boolean }) {
  const [showAll, setShowAll] = useState(false);
  const lines = text.split("\n");
  const clipped = !showAll && lines.length > TAIL_LINES;
  return (
    <>
      {clipped ? (
        <div className="flex items-center gap-2 label-micro text-basic-muted">
          <span>
            Last {TAIL_LINES} of {lines.length} lines
          </span>
          <button
            type="button"
            className="text-basic-primary hover:underline"
            onClick={() => setShowAll(true)}
          >
            Show all
          </button>
        </div>
      ) : null}
      <div className="chat-response">
        <div className="thinking-content">
          <Markdown className="text-basic-tertiary" streaming={streaming}>
            {clipped ? lines.slice(-TAIL_LINES).join("\n") : text}
          </Markdown>
        </div>
      </div>
    </>
  );
}
