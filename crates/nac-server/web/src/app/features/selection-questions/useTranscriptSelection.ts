import { useEffect, useState, type RefObject } from "react";

/** A non-empty selection that lies entirely inside one completed reply block. */
export interface TranscriptSelection {
  messageIndex: number;
  text: string;
  /** Where the selection starts within the rendered block, from 0 to 1. */
  hint: number;
  /** Viewport rectangle of the selection, for placing the affordance. */
  top: number;
  left: number;
}

const SOURCE_ATTRIBUTE = "data-selection-source";

function sourceOf(node: Node | null): HTMLElement | null {
  const element = node instanceof HTMLElement ? node : (node?.parentElement ?? null);
  return element?.closest<HTMLElement>(`[${SOURCE_ATTRIBUTE}]`) ?? null;
}

/** Read the current document selection; null unless it is inside one block. */
export function readTranscriptSelection(container: HTMLElement | null): TranscriptSelection | null {
  const selection = typeof window === "undefined" ? null : window.getSelection();
  if (!container || !selection || selection.isCollapsed || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  const source = sourceOf(range.startContainer);
  if (!source || source !== sourceOf(range.endContainer) || !container.contains(source)) {
    return null;
  }
  const text = selection.toString();
  const messageIndex = Number(source.getAttribute(SOURCE_ATTRIBUTE));
  if (!text.trim() || !Number.isInteger(messageIndex)) return null;
  const before = document.createRange();
  before.selectNodeContents(source);
  before.setEnd(range.startContainer, range.startOffset);
  const total = source.textContent?.length ?? 0;
  // Layout-free environments have no range geometry; place it at the origin.
  const rect =
    typeof range.getBoundingClientRect === "function"
      ? range.getBoundingClientRect()
      : { top: 0, bottom: 0, left: 0 };
  // Scrolled out of view: there is nothing on screen to point the control at.
  if (rect.bottom < 0 || rect.top > window.innerHeight) return null;
  return {
    messageIndex,
    text,
    hint: total > 0 ? before.toString().length / total : 0,
    top: rect.bottom,
    left: rect.left,
  };
}

/**
 * Follow the person's text selection inside the transcript. Only selections
 * confined to one completed assistant prose block qualify; streaming text,
 * tool output and reasoning are never marked as sources.
 */
export function useTranscriptSelection(
  containerRef: RefObject<HTMLElement | null>,
  enabled: boolean,
): [TranscriptSelection | null, () => void] {
  const [selection, setSelection] = useState<TranscriptSelection | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() =>
        setSelection(readTranscriptSelection(containerRef.current)),
      );
    };
    document.addEventListener("selectionchange", update);
    // The reply moves under the fixed control whenever the transcript scrolls,
    // including while a running chat keeps it pinned to the bottom. Scroll
    // does not bubble, so it is caught on the way down.
    document.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("selectionchange", update);
      document.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [containerRef, enabled]);
  return [enabled ? selection : null, () => setSelection(null)];
}
