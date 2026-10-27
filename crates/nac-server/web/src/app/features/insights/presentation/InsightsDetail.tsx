import { useEffect, useLayoutEffect, useRef } from "react";

import type { InsightGroup, InsightSegment } from "@/app/features/insights/model/types";
import { InsightSegmentItem } from "@/app/features/insights/presentation/items/InsightSegmentItem";
import type { ItemContext } from "@/app/features/insights/presentation/items/itemContent";
import {
  distanceFromBottom,
  scrollToBottomInstantly,
  smoothScrollTo,
  STICK_TOLERANCE_PX,
} from "@/app/lib/scroll";

/** Changes whenever the newest segment grows, so a following view keeps up with it. */
function growthSeed(segment: InsightSegment | undefined): string {
  if (!segment) return "";
  if (segment.kind === "reasoning") return `${segment.key}:${segment.text.length}`;
  if (segment.kind === "workset") return `${segment.key}:${segment.pending}`;
  const { presentation } = segment;
  return `${segment.key}:${presentation?.status ?? segment.pending}:${presentation?.resultPreview?.length ?? 0}`;
}

function segmentElement(root: HTMLElement, key: string): HTMLElement | null {
  return (
    Array.from(root.querySelectorAll<HTMLElement>("[data-segment-key]")).find(
      (element) => element.dataset.segmentKey === key,
    ) ?? null
  );
}

/** Key it by group: whether the reader sits at the bottom is remembered per group. */
export function InsightsDetail({
  group,
  segmentKey,
  focusNonce,
  context,
}: {
  group: InsightGroup;
  segmentKey: string | null;
  focusNonce: number;
  context: ItemContext;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const stuckRef = useRef(true);
  const focusedNonce = useRef<number | null>(null);
  const glide = useRef<AbortController | null>(null);
  const running = group.status === "running";
  const followSeed = `${group.segments.length}:${growthSeed(group.segments.at(-1))}`;

  useEffect(() => () => glide.current?.abort(), []);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (root && running && stuckRef.current) scrollToBottomInstantly(root);
  }, [followSeed, running]);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root || focusedNonce.current === focusNonce) return;
    const mounting = focusedNonce.current === null;
    focusedNonce.current = focusNonce;
    const target = segmentKey ? segmentElement(root, segmentKey) : null;
    if (mounting && !target) {
      stuckRef.current = running || distanceFromBottom(root) <= STICK_TOLERANCE_PX;
      return;
    }
    stuckRef.current = !target && running;
    const top = target
      ? root.scrollTop + target.getBoundingClientRect().top - root.getBoundingClientRect().top
      : running
        ? root.scrollHeight
        : 0;
    glide.current?.abort();
    if (mounting) {
      root.scrollTop = top;
      return;
    }
    const controller = new AbortController();
    glide.current = controller;
    void smoothScrollTo(root, top, undefined, controller.signal);
  }, [focusNonce, segmentKey, running]);

  return (
    <div
      ref={rootRef}
      className="flex min-h-0 flex-1 flex-col overflow-auto [&>*]:shrink-0"
      onScroll={() => {
        const root = rootRef.current;
        if (root) stuckRef.current = distanceFromBottom(root) <= STICK_TOLERANCE_PX;
      }}
    >
      {/* The phone's tab bar floats over the bottom of the column. */}
      <div className="flex flex-col pb-[128px] md:pb-0">
        {group.segments.map((segment) => (
          <div key={segment.key} data-segment-key={segment.key}>
            <InsightSegmentItem
              segment={segment}
              active={segment.key === segmentKey}
              context={context}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
