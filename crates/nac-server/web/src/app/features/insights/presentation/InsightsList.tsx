import { useEffect, useRef } from "react";

import type { InsightsEmptyCopy, InsightTurnSection } from "@/app/features/insights/model/types";
import {
  InsightsTurnSection,
  type InsightsRowController,
} from "@/app/features/insights/presentation/InsightsTurnSection";
import { STREAMING_TURN_KEY } from "@/app/lib/transcript";

const LEADING_HEADING = "Earlier messages";
const STREAMING_HEADING = "New prompt";

export function InsightsList({
  sections,
  pendingPrompt,
  emptyCopy,
  focusNonce,
  controller,
}: {
  sections: readonly InsightTurnSection[];
  /** The prompt a streamed turn answers before the snapshot shows it. */
  pendingPrompt: string;
  emptyCopy: InsightsEmptyCopy;
  /** Bumps on every pick; the picked row is scrolled into view. */
  focusNonce: number;
  controller: InsightsRowController;
}) {
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const picked = listRef.current?.querySelectorAll<HTMLElement>('[aria-pressed="true"]');
    picked?.[picked.length - 1]?.scrollIntoView?.({ block: "nearest" });
  }, [focusNonce]);

  if (!sections.length) {
    return <p className="p-1 label-micro text-basic-muted">{emptyCopy.title}</p>;
  }
  const pending = pendingPrompt.replace(/\s+/g, " ").trim();
  return (
    <div ref={listRef} className="flex flex-col [&>*]:shrink-0">
      {sections.map((section, index) => (
        <InsightsTurnSection
          key={section.key}
          section={section}
          first={index === 0}
          fallbackPrompt={
            section.key === STREAMING_TURN_KEY ? pending || STREAMING_HEADING : LEADING_HEADING
          }
          controller={controller}
        />
      ))}
    </div>
  );
}
