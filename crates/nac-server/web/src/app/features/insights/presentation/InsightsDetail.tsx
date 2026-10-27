import { memo, useEffect, useLayoutEffect, useRef } from "react";

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

/**
 * Where an element starts in the column's content, wherever the column is
 * scrolled, less the scroll padding a floating header covers.
 */
function offsetIn(root: HTMLElement, element: HTMLElement): number {
  const covered = parseFloat(getComputedStyle(root).scrollPaddingTop) || 0;
  return (
    root.scrollTop +
    element.getBoundingClientRect().top -
    root.getBoundingClientRect().top -
    covered
  );
}

/** Key it by group: whether the reader sits at the bottom is remembered per group. */
export const InsightsDetail = memo(function InsightsDetail({
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
  const contentRef = useRef<HTMLDivElement>(null);
  const stuckRef = useRef(true);
  /** The picked segment and where it starts, held there until the reader takes over. */
  const pinRef = useRef<{ key: string; top: number } | null>(null);
  const focusedNonce = useRef<number | null>(null);
  const glide = useRef<AbortController | null>(null);
  const running = group.status === "running";
  const followSeed = `${group.segments.length}:${growthSeed(group.segments.at(-1))}`;

  useEffect(() => () => glide.current?.abort(), []);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (root && running && stuckRef.current) scrollToBottomInstantly(root);
  }, [followSeed, running]);

  // Items grow after they render, e.g. a write once its diff loads. Scroll
  // anchoring keeps whatever sits at the top of the column, which is not the
  // picked segment while the column cannot scroll down to it.
  useEffect(() => {
    const root = rootRef.current;
    const content = contentRef.current;
    if (!root || !content) return;
    const observer = new ResizeObserver(() => {
      const pin = pinRef.current;
      const target = pin ? segmentElement(root, pin.key) : null;
      if (!pin || !target) return;
      const top = offsetIn(root, target);
      if (Math.abs(top - pin.top) < 1) return;
      pin.top = top;
      glide.current?.abort();
      root.scrollTop = top;
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, []);

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
    const top = target ? offsetIn(root, target) : running ? root.scrollHeight : 0;
    pinRef.current = target && segmentKey ? { key: segmentKey, top } : null;
    glide.current?.abort();
    if (mounting) {
      root.scrollTop = top;
      return;
    }
    const controller = new AbortController();
    glide.current = controller;
    void smoothScrollTo(root, top, undefined, controller.signal);
  }, [focusNonce, segmentKey, running]);

  const release = () => {
    pinRef.current = null;
  };
  // A phone's header floats over the top of the column: the content starts
  // below it, and the scroll padding keeps a picked segment out from under it.
  return (
    <div
      ref={rootRef}
      className="flex min-h-0 flex-1 flex-col overflow-auto max-md:scroll-pt-14 [&>*]:shrink-0"
      onScroll={() => {
        const root = rootRef.current;
        if (root) stuckRef.current = distanceFromBottom(root) <= STICK_TOLERANCE_PX;
      }}
      onWheel={release}
      onPointerDown={release}
      onKeyDown={release}
    >
      <div ref={contentRef} className="flex flex-col max-md:py-14">
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
});
