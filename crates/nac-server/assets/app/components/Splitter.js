import { React, html } from "../lib/html.js";
import { usePaneRatio, setPaneRatio } from "../store/selectionStore.js";

const { useCallback } = React;
const STEP = 0.03;
const BIG_STEP = 0.1;
const MIN_RATIO = 0.2;
const MAX_RATIO = 0.75;

export function Splitter({ containerRef }) {
  const ratio = usePaneRatio();

  const onPointerDown = useCallback(
    (e) => {
      e.preventDefault();
      const el = containerRef && containerRef.current;
      if (!el) return;
      const move = (ev) => {
        const rect = el.getBoundingClientRect();
        if (rect.width <= 0) return;
        setPaneRatio((ev.clientX - rect.left) / rect.width);
      };
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        document.body.style.userSelect = "";
      };
      document.body.style.userSelect = "none";
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    },
    [containerRef],
  );

  const onKeyDown = useCallback(
    (e) => {
      const step = e.shiftKey ? BIG_STEP : STEP;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        setPaneRatio(ratio - step);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        setPaneRatio(ratio + step);
      } else if (e.key === "Home") {
        e.preventDefault();
        setPaneRatio(MIN_RATIO);
      } else if (e.key === "End") {
        e.preventDefault();
        setPaneRatio(MAX_RATIO);
      }
    },
    [ratio],
  );

  return html`<div
    role="separator"
    aria-label="Resize panels"
    aria-orientation="vertical"
    aria-valuemin=${20}
    aria-valuemax=${75}
    aria-valuenow=${Math.round(ratio * 100)}
    tabindex="0"
    onPointerDown=${onPointerDown}
    onKeyDown=${onKeyDown}
    class="relative w-1.5 shrink-0 cursor-col-resize bg-elevation-level-0-5 hover:bg-accent-primary transition-colors"
  >
    <span
      class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-8 w-[3px] rounded-full bg-elevation-level-3"
      aria-hidden="true"
    ></span>
  </div>`;
}
