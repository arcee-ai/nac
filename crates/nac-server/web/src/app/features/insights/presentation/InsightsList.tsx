import { memo, useEffect, useRef, type ReactNode } from "react";

import type { InsightsEmptyCopy, InsightTurnSection } from "@/app/features/insights/model/types";
import {
  InsightsTurnSection,
  type InsightsRowController,
} from "@/app/features/insights/presentation/InsightsTurnSection";
import { STREAMING_TURN_KEY } from "@/app/lib/transcript";

const LEADING_HEADING = "Earlier messages";
const STREAMING_HEADING = "New prompt";

function verticalScroller(element: HTMLElement): HTMLElement | null {
  for (let node = element.parentElement; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if (overflowY === "auto" || overflowY === "scroll") return node;
  }
  return null;
}

/**
 * `scrollIntoView({ block: "nearest" })` limited to the list's own scroller.
 * The native call also scrolls every clipping ancestor, and the collapsed side
 * panel sits off-screen inside one: revealing a row there shifted the session.
 */
function revealRow(row: HTMLElement): void {
  const scroller = verticalScroller(row);
  if (!scroller) return;
  const viewTop = scroller.getBoundingClientRect().top + scroller.clientTop;
  const viewBottom = viewTop + scroller.clientHeight;
  const { top, bottom } = row.getBoundingClientRect();
  if (top < viewTop) scroller.scrollTop += top - viewTop;
  else if (bottom > viewBottom) scroller.scrollTop += Math.min(bottom - viewBottom, top - viewTop);
}

export const InsightsList = memo(function InsightsList({
  sections,
  pendingPrompt,
  emptyCopy,
  focusNonce,
  controller,
  footer,
}: {
  sections: readonly InsightTurnSection[];
  /** The prompt a streamed turn answers before the snapshot shows it. */
  pendingPrompt: string;
  emptyCopy: InsightsEmptyCopy;
  /** Bumps on every pick; the picked row is scrolled into view. */
  focusNonce: number;
  controller: InsightsRowController;
  /** After the oldest section, and under the empty copy too. */
  footer?: ReactNode;
}) {
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const picked = listRef.current?.querySelectorAll<HTMLElement>('[aria-pressed="true"]');
    const row = picked?.[picked.length - 1];
    if (row) revealRow(row);
  }, [focusNonce]);

  if (!sections.length) {
    return (
      <>
        <p className="p-1 label-micro text-basic-muted">{emptyCopy.title}</p>
        {footer}
      </>
    );
  }
  const pending = pendingPrompt.replace(/\s+/g, " ").trim();
  return (
    <div ref={listRef} className="flex flex-col [&>*]:shrink-0">
      {sections.map((section) => (
        <InsightsTurnSection
          key={section.key}
          section={section}
          fallbackPrompt={
            section.key === STREAMING_TURN_KEY ? pending || STREAMING_HEADING : LEADING_HEADING
          }
          controller={controller}
        />
      ))}
      {footer}
    </div>
  );
});
