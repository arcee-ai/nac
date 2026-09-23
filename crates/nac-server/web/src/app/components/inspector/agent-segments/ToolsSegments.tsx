import { memo, useMemo } from "react";

import { ToolPill, ToolPillSize, ToolPillState } from "@/app/atoms";
import { useIsMobile } from "@/app/hooks/useMediaQuery";
import {
  COUPLER_WIDTH_PX,
  MAX_PILLS_DESKTOP,
  MAX_PILLS_MOBILE,
  PILL_SLOT_PX,
  PILL_TRANSITION_MS,
  visibleToolsItems,
  type ToolsSegmentItem,
} from "@/app/lib/agentSegments";
import { cn } from "@/app/lib/cn";
import { formatSeconds } from "@/app/lib/format";

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function Coupler() {
  return (
    <div
      aria-hidden="true"
      className="h-px shrink-0 bg-[var(--color-border-tertiary)]"
      style={{ width: `${COUPLER_WIDTH_PX}px` }}
    />
  );
}

const ToolPillRow = memo(function ToolPillRow({
  item,
  showCoupler,
}: {
  item: ToolsSegmentItem;
  showCoupler: boolean;
}) {
  const state = item.live
    ? ToolPillState.Active
    : item.failed
      ? ToolPillState.Error
      : ToolPillState.Default;
  return (
    <>
      {showCoupler ? <Coupler /> : null}
      <ToolPill
        aria-label={`${item.label}: ${item.statusLabel}`}
        data-segment-id={item.id}
        icon={item.icon}
        size={ToolPillSize.Small}
        state={state}
      />
    </>
  );
});

export interface ToolsSegmentsProps {
  items: ToolsSegmentItem[];
  label: string;
  durationMs?: number | null;
  inProgress?: boolean;
  active?: boolean;
  className?: string;
  ariaLabel?: string;
  onClick?: () => void;
}

function ToolsSegments({
  items,
  label,
  durationMs,
  inProgress = false,
  active = false,
  className,
  ariaLabel,
  onClick,
}: ToolsSegmentsProps) {
  const isMobile = useIsMobile();
  const maxPills = isMobile ? MAX_PILLS_MOBILE : MAX_PILLS_DESKTOP;
  const visible = useMemo(() => visibleToolsItems(items, maxPills), [items, maxPills]);
  const viewportMaxPx = maxPills * PILL_SLOT_PX - COUPLER_WIDTH_PX;
  const innerWidthPx = Math.max(0, visible.items.length * PILL_SLOT_PX - COUPLER_WIDTH_PX);
  const reducedMotion = useMemo(() => prefersReducedMotion(), []);

  return (
    <button
      type="button"
      className={cn(
        "inline-flex max-w-full min-w-0 items-center gap-4 rounded-r-full border-l-2 p-2 pl-4 transition-colors",
        active ? "btn-secondary-highlighted border-l-primary" : "btn-ghost border-l-tertiary",
        className,
      )}
      aria-pressed={active || undefined}
      aria-label={ariaLabel ?? label}
      onClick={onClick}
    >
      <div className="flex shrink-0 items-center">
        {visible.overflowCount > 0 ? (
          <>
            <ToolPill.Overflow count={visible.overflowCount} size={ToolPillSize.Small} />
            <Coupler />
          </>
        ) : null}
        <div
          className="flex items-center overflow-hidden"
          style={{ maxWidth: `${viewportMaxPx}px` }}
        >
          <div
            className="flex items-center"
            style={{
              width: `${innerWidthPx}px`,
              transition:
                inProgress && !reducedMotion ? `width ${PILL_TRANSITION_MS}ms ease-out` : "none",
            }}
          >
            {visible.items.map((item, index) => (
              <ToolPillRow key={item.id} item={item} showCoupler={index > 0} />
            ))}
          </div>
        </div>
      </div>
      <div className="flex min-w-0 items-center gap-2 pr-2">
        <span
          className={cn(
            "label-micro min-w-0 truncate",
            inProgress ? "text-shimmer-basic" : "text-basic-tertiary",
          )}
        >
          {label}
        </span>
        {!inProgress && durationMs != null ? (
          <span className="text-micro shrink-0 whitespace-nowrap text-basic-muted">
            {formatSeconds(durationMs)}
          </span>
        ) : null}
      </div>
    </button>
  );
}

export default memo(ToolsSegments);
