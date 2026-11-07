import {
  memo,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react";

import { ActionListButtonSize } from "@/app/atoms";
import type { InsightsEmptyCopy, InsightTurnSection } from "@/app/features/insights/model/types";
import {
  InsightsTurnSection,
  type InsightsRowController,
} from "@/app/features/insights/presentation/InsightsTurnSection";
import { InsightsNavigationContext } from "@/app/features/insights/useInsightsNavigation";
import { useIsMobile, useIsTablet } from "@/app/hooks/useMediaQuery";
import { useNativeRuntime } from "@/app/runtime/RuntimeContext";
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
 * The scroller's padding counts as out of view: on a phone it is what keeps the
 * rows clear of the floating header and tab bar.
 */
function revealRow(row: HTMLElement): void {
  const scroller = verticalScroller(row);
  if (!scroller) return;
  const style = getComputedStyle(scroller);
  const padTop = parseFloat(style.paddingTop) || 0;
  const padBottom = parseFloat(style.paddingBottom) || 0;
  const viewTop = scroller.getBoundingClientRect().top + scroller.clientTop + padTop;
  const viewBottom = viewTop + scroller.clientHeight - padTop - padBottom;
  const { top, bottom } = row.getBoundingClientRect();
  if (top < viewTop) scroller.scrollTop += top - viewTop;
  else if (bottom > viewBottom) scroller.scrollTop += Math.min(bottom - viewBottom, top - viewTop);
}

function shownRow(list: HTMLElement): HTMLElement | null {
  const rows = list.querySelectorAll<HTMLElement>("button[data-shown]");
  return rows[rows.length - 1] ?? null;
}

/** A zero-sized/unavailable row cannot provide a reliable visual anchor. */
function rowOffset(row: HTMLElement | null, scroller: HTMLElement): number | null {
  if (!row) return null;
  const bounds = row.getBoundingClientRect();
  const viewport = scroller.getBoundingClientRect();
  const offset = bounds.top - viewport.top;
  return bounds.height > 0 && viewport.height > 0 && Number.isFinite(offset) ? offset : null;
}

/** Stable transcript identity, independent of labels and changing tool status. */
function shownRowKey(
  sections: readonly InsightTurnSection[],
  controller: InsightsRowController,
): string | null {
  let key: string | null = null;
  // Match the DOM's last shown row, including an episode-less thread pick.
  for (const section of sections) {
    for (const entry of section.entries) {
      if (controller.entryShown(entry)) key = JSON.stringify(["entry", entry.kind, entry.id]);
      if (entry.kind === "group" && controller.expanded.has(entry.id)) {
        for (const segment of entry.group.segments) {
          if (controller.segmentShown(entry, segment))
            key = JSON.stringify(["segment", entry.id, segment.key]);
        }
      }
    }
  }
  return key;
}

export const InsightsList = memo(function InsightsList({
  sessionId,
  sections,
  pendingPrompt,
  emptyCopy,
  focusNonce,
  controller,
  footer,
}: {
  sessionId: string;
  sections: readonly InsightTurnSection[];
  /** The prompt a streamed turn answers before the snapshot shows it. */
  pendingPrompt: string;
  emptyCopy: InsightsEmptyCopy;
  /** Bumps on every pick; the shown row is scrolled into view. */
  focusNonce: number;
  controller: InsightsRowController;
  /** After the oldest section, and under the empty copy too. */
  footer?: ReactNode;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const hasRows = sections.length > 0;
  const { sessionLayoutStore, rememberInsightListPosition, useSidePanelList } =
    useNativeRuntime().stores.sessionLayoutStore;
  const restored = useRef(false);
  const anchorKey = useMemo(() => shownRowKey(sections, controller), [sections, controller]);
  const latestAnchorKey = useRef(anchorKey);
  const renderedSource = useRef({
    focusNonce,
    sourceEpoch: sessionLayoutStore.getState().insightSelectionEpoch,
  });
  useLayoutEffect(() => {
    latestAnchorKey.current = anchorKey;
    renderedSource.current = {
      focusNonce,
      sourceEpoch: sessionLayoutStore.getState().insightSelectionEpoch,
    };
  });
  const { detailFocusRef, returnFocusRef } = useContext(InsightsNavigationContext);
  const mobile = useIsMobile();
  const tablet = useIsTablet();
  const listOpen = useSidePanelList();
  useEffect(() => {
    if (!hasRows || !(mobile || tablet) || !listOpen || !returnFocusRef?.current) return undefined;
    const frame = requestAnimationFrame(() => {
      const list = listRef.current;
      if (!list || !returnFocusRef.current) return;
      const target = shownRow(list) ?? list;
      returnFocusRef.current = false;
      detailFocusRef.current = null;
      target.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [hasRows, mobile, tablet, listOpen, returnFocusRef, detailFocusRef]);
  useLayoutEffect(() => {
    const list = listRef.current;
    const scroller = list && verticalScroller(list);
    if (!scroller) return undefined;
    restored.current = false;
    const state = sessionLayoutStore.getState();
    const saved = state.insightListPositions.get(sessionId);
    if (
      saved != null &&
      saved.focusNonce === state.insightFocusNonce &&
      saved.sourceEpoch === state.insightSelectionEpoch
    ) {
      const offset = rowOffset(shownRow(list), scroller);
      if (offset != null && saved.anchor && saved.anchor.key === latestAnchorKey.current) {
        scroller.scrollTop += offset - saved.anchor.offset;
      } else scroller.scrollTop = saved.top;
      restored.current = true;
    }
    const remember = () => {
      const offset = rowOffset(shownRow(list), scroller);
      const key = latestAnchorKey.current;
      rememberInsightListPosition(
        sessionId,
        scroller.scrollTop,
        offset != null && key ? { key, offset } : null,
        // A pick may already have changed the store before this old DOM unmounts.
        renderedSource.current,
      );
    };
    scroller.addEventListener("scroll", remember, { passive: true });
    return () => {
      remember();
      scroller.removeEventListener("scroll", remember);
    };
  }, [hasRows, sessionId, sessionLayoutStore, rememberInsightListPosition]);
  const size = mobile ? ActionListButtonSize.Large : ActionListButtonSize.Small;

  useEffect(() => {
    // A remount after a panel/child-page trip restores the reader's position.
    // A subsequent explicit pick still reveals its requested row.
    if (!hasRows) return;
    if (restored.current) {
      restored.current = false;
      return;
    }
    const row = listRef.current && shownRow(listRef.current);
    if (row) revealRow(row);
  }, [focusNonce, hasRows]);

  if (!hasRows) {
    return (
      <>
        <p className="p-1 label-micro text-basic-muted">{emptyCopy.title}</p>
        {footer}
      </>
    );
  }
  const pending = pendingPrompt.replace(/\s+/g, " ").trim();
  return (
    <div ref={listRef} tabIndex={-1} className="flex flex-col [&>*]:shrink-0">
      {sections.map((section) => (
        <InsightsTurnSection
          key={section.key}
          section={section}
          fallbackPrompt={
            section.key === STREAMING_TURN_KEY ? pending || STREAMING_HEADING : LEADING_HEADING
          }
          controller={controller}
          size={size}
        />
      ))}
      {footer}
    </div>
  );
});
