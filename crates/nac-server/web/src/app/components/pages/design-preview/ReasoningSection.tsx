import { useState } from "react";

import { BoxSurface, Button, ButtonVariant } from "@/app/atoms";
import { ReasoningItem } from "@/app/features/insights/presentation/items/ReasoningItem";
import { Markdown } from "@/app/lib/markdown";

const TEXT =
  "The build spends most of its time preparing images. I’ll check the cache key before changing the build steps.\n\nA stable key should include the lockfile and image directory so unchanged inputs can reuse the cache.";

export function ReasoningSection() {
  const [streaming, setStreaming] = useState(true);
  return (
    <BoxSurface title="Conversation: reasoning and answer">
      <div className="p-4 flex min-w-0 flex-col gap-4">
        <p className="text-small text-basic-secondary">
          Reasoning: 14px / 22px, secondary text, 12px paragraphs, 16px inset, 1px tertiary rule, no
          filled surface. Header and copy targets: 44px. Answer: existing 14px / 24px primary prose.
          Live opens; settled starts closed. A reader’s toggle, focus or selection wins on
          settlement. Activity remains a link to Insights; this is its reasoning detail, without a
          second heading.
        </p>
        <Button variant={ButtonVariant.Secondary} onClick={() => setStreaming(!streaming)}>
          {streaming ? "Settle reasoning" : "Resume reasoning"}
        </Button>
        <ReasoningItem
          segment={{
            kind: "reasoning",
            key: "preview",
            text: TEXT,
            streaming,
            durationMs: streaming ? null : 2300,
          }}
          active={false}
        />
        <Markdown>Use a stable image cache key to avoid rebuilding unchanged images.</Markdown>
      </div>
    </BoxSurface>
  );
}
