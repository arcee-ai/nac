import { memo, useMemo } from "react";

import ToolPill, { ToolPillState } from "@/app/atoms/tool-pill";
import { useIsMobile } from "@/app/hooks/useMediaQuery";
import {
  COUPLER_WIDTH_PX,
  MAX_PILLS_DESKTOP,
  MAX_PILLS_MOBILE,
  PILL_SLOT_PX,
  PILL_TRANSITION_MS,
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
      className="h-0.5 shrink-0 bg-[var(--color-border-accent-primary)]"
      style={{ width: `${COUPLER_WIDTH_PX}px` }}
    />
  );
}

const ToolPillRow = memo(function ToolPillRow({
  pill,
  isActive,
  showCoupler,
}: {
  pill: ToolsSegmentItem;
  isActive: boolean;
  showCoupler: boolean;
}) {
  return (
    <>
      {showCoupler ? <Coupler /> : null}
      <ToolPill
        icon={pill.icon}
        state={isActive ? ToolPillState.Active : ToolPillState.Default}
      />
    </>
  );
});

export function ToolsSegments({
  items,
  durationMs,
  inProgress = false,
  active = false,
  overflowCount = 0,
  className,
  ariaLabel,
  onClick,
}: {
  items: ToolsSegmentItem[];
  durationMs?: number | null;
  inProgress?: boolean;
  active?: boolean;
  overflowCount?: number;
  className?: string;
  ariaLabel?: string;
  onClick?: () => void;
}) {
  const isMobile = useIsMobile();
  const maxPills = isMobile ? MAX_PILLS_MOBILE : MAX_PILLS_DESKTOP;
  const viewportMaxPx = maxPills * PILL_SLOT_PX - COUPLER_WIDTH_PX;
  const showDuration = !inProgress && durationMs != null;
  const innerWidthPx =
    (items.length + (overflowCount > 0 ? overflowCount : 0)) * PILL_SLOT_PX -
    COUPLER_WIDTH_PX;
  const translateXPx = -(
    (overflowCount > 0 ? overflowCount : 0) * PILL_SLOT_PX
  );
  const lastItemId = items.length > 0 ? items[items.length - 1].id : undefined;
  const reducedMotion = useMemo(() => prefersReducedMotion(), []);

  return (
    <button
      type="button"
      className={cn(
        "inline-flex items-center gap-4 rounded-full p-2 transition-colors -translate-x-2",
        active
          ? "cursor-pointer btn-secondary-accent-highlighted"
          : "cursor-pointer btn-ghost-accent",
        className,
      )}
      aria-pressed={active || undefined}
      aria-label={ariaLabel ?? "Thoughts and tool calls"}
      onClick={onClick}
    >
      <div className="flex items-center shrink-0">
        {overflowCount > 0 ? (
          <>
            <ToolPill.Overflow count={overflowCount} />
            <Coupler />
          </>
        ) : null}
        <div
          className="overflow-hidden flex items-center"
          style={{ maxWidth: `${viewportMaxPx}px` }}
        >
          <div
            className="flex items-center justify-end"
            style={{
              width: `${innerWidthPx}px`,
              minWidth: `${innerWidthPx}px`,
              maxWidth: `${innerWidthPx}px`,
              transform: `translateX(${translateXPx}px)`,
              transition:
                inProgress && !reducedMotion
                  ? `transform ${PILL_TRANSITION_MS}ms ease-out`
                  : "none",
            }}
          >
            {items.map((pill, idx) => (
              <ToolPillRow
                key={pill.id}
                pill={pill}
                isActive={inProgress && pill.id === lastItemId}
                showCoupler={idx > 0}
              />
            ))}
          </div>
        </div>
      </div>
      {showDuration ? (
        <span className="text-small text-basic-primary text-right shrink-0 whitespace-nowrap pr-2">
          {formatSeconds(durationMs)}
        </span>
      ) : null}
    </button>
  );
}
