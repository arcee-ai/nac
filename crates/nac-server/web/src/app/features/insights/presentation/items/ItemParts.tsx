import { type ReactNode } from "react";

import { InsightLinkButton } from "@/app/atoms";
import type { ItemContext } from "@/app/features/insights/presentation/items/itemContent";
import type { SessionLink } from "@/app/features/insights/presentation/useDelegatedSessions";
import { Markdown } from "@/app/lib/markdown";

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
  // Keep the renderer's append-only block identities through chunks and
  // settlement. Substituting a moving tail here rebinds selected/focused DOM.
  // The detail column already owns scrolling; reasoning needs no second pane.
  return (
    <div className="reasoning-prose">
      <Markdown className="text-basic-secondary" streaming={streaming}>
        {text}
      </Markdown>
    </div>
  );
}
