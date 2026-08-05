import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";

import { cn } from "@/app/lib/cn";
import {
  clampPanelListWidth,
  PANEL_LIST_MAX_RATIO,
  PANEL_LIST_MIN_WIDTH,
  setPanelListWidth,
  usePanelListWidth,
} from "@/app/hooks/usePanelListWidth";

/**
 * The shape all three side-box panels share: a narrow list of rows on the left
 * and the detail of whatever is selected on the right.
 */
export function PanelSplit({
  list,
  listHeader,
  children,
}: {
  list: ReactNode;
  /** Toolbar pinned above the list, staying put while the list scrolls. */
  listHeader?: ReactNode;
  children: ReactNode;
}) {
  const storedWidth = usePanelListWidth();
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const dragging = useRef(false);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return undefined;
    const measure = () => setContainerWidth(element.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const maxWidth =
    containerWidth > 0 ? containerWidth * PANEL_LIST_MAX_RATIO : storedWidth;
  const listWidth = clampPanelListWidth(storedWidth, maxWidth);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const container = containerRef.current;
    if (!container) return;
    event.preventDefault();
    dragging.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const onMove = (moveEvent: PointerEvent) => {
      if (!dragging.current) return;
      const rect = container.getBoundingClientRect();
      const next = moveEvent.clientX - rect.left;
      setPanelListWidth(
        clampPanelListWidth(next, rect.width * PANEL_LIST_MAX_RATIO),
      );
    };

    const onUp = (upEvent: PointerEvent) => {
      dragging.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      try {
        event.currentTarget.releasePointerCapture(upEvent.pointerId);
      } catch {
        // Already released.
      }
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };

  return (
    <div
      ref={containerRef}
      className="flex flex-1 min-h-0 w-full"
    >
      <div
        className="relative flex flex-col shrink-0 min-h-0 border-r border-muted bg-elevation-level-1"
        style={{ width: listWidth }}
      >
        {listHeader}
        <div className="flex flex-col flex-1 min-h-0 overflow-auto pt-4 px-1 [&>*]:shrink-0">
          {list}
        </div>
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize list panel"
          aria-valuemin={PANEL_LIST_MIN_WIDTH}
          aria-valuemax={Math.round(maxWidth)}
          aria-valuenow={listWidth}
          tabIndex={0}
          className="absolute inset-y-0 -right-1 z-10 w-2 cursor-col-resize touch-none"
          onPointerDown={onPointerDown}
          onKeyDown={(event) => {
            const step = event.shiftKey ? 24 : 8;
            if (event.key === "ArrowLeft") {
              event.preventDefault();
              setPanelListWidth(
                clampPanelListWidth(listWidth - step, maxWidth),
              );
            } else if (event.key === "ArrowRight") {
              event.preventDefault();
              setPanelListWidth(
                clampPanelListWidth(listWidth + step, maxWidth),
              );
            }
          }}
        />
      </div>
      <div className="flex flex-col flex-1 min-w-0 min-h-0 bg-elevation-level-0-5">
        {children}
      </div>
    </div>
  );
}

/** Row of the left list, sized to the 24px tree row in the design. */
export function PanelRow({
  label,
  active = false,
  icon,
  trailing,
  labelClassName,
  title,
  onClick,
}: {
  label: string;
  active?: boolean;
  icon?: ReactNode;
  trailing?: ReactNode;
  /** Overrides the label colour, e.g. to mark a file's git status. */
  labelClassName?: string;
  title?: string;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      className={cn(
        "flex items-center gap-1 p-1 w-full rounded-[4px] text-left",
        active ? "btn-ghost-highlighted" : "btn-ghost",
      )}
      aria-pressed={active}
      title={title}
      onClick={onClick}
    >
      {icon}
      <span
        className={cn(
          "flex-1 min-w-0 truncate label-micro",
          labelClassName ?? "text-btn-secondary",
        )}
      >
        {label}
      </span>
      {trailing}
    </button>
  );
}

/** Placeholder for an empty or not-yet-selected panel. */
export function PanelEmpty({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-1 flex-col min-h-0 overflow-auto p-6 label-small text-basic-muted [&>*]:shrink-0">
      {children}
    </div>
  );
}
