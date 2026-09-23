import { memo, useMemo } from "react";

import { ToolPill, ToolPillSize, ToolPillState } from "@/app/atoms";
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
      aria-hidden="true"
      className="h-px shrink-0 bg-[var(--color-border-tertiary)]"
      style={{ width: `${COUPLER_WIDTH_PX}px` }}
    />
  );
}

const ToolPillRow = memo(function ToolPillRow({
  item,
  active,
  showCoupler,
}: {
  item: ToolsSegmentItem;
  active: boolean;
  showCoupler: boolean;
}) {
  const state = active
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

function toolsSegmentsPropsAreEqual(
  previous: Readonly<ToolsSegmentsProps>,
  next: Readonly<ToolsSegmentsProps>,
): boolean {
  if (
    previous.inProgress !== next.inProgress ||
    previous.active !== next.active ||
    previous.durationMs !== next.durationMs ||
    previous.label !== next.label ||
    previous.className !== next.className ||
    previous.ariaLabel !== next.ariaLabel ||
    previous.onClick !== next.onClick ||
    previous.items.length !== next.items.length
  ) {
    return false;
  }
  return previous.items.every((item, index) => {
    const candidate = next.items[index];
    return (
      item.id === candidate.id &&
      item.icon === candidate.icon &&
      item.label === candidate.label &&
      item.statusLabel === candidate.statusLabel &&
      item.live === candidate.live &&
      item.failed === candidate.failed
    );
  });
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
  const viewportMaxPx = maxPills * PILL_SLOT_PX - COUPLER_WIDTH_PX;
  const renderedItems = items;
  const overflowCount = Math.max(0, renderedItems.length - maxPills);
  const innerWidthPx = Math.max(0, renderedItems.length * PILL_SLOT_PX - COUPLER_WIDTH_PX);
  const translateXPx = -(overflowCount * PILL_SLOT_PX);
  const lastItemId = items.at(-1)?.id;
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
        {overflowCount > 0 ? (
          <>
            <ToolPill.Overflow count={overflowCount} size={ToolPillSize.Small} />
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
              minWidth: `${innerWidthPx}px`,
              maxWidth: `${innerWidthPx}px`,
              transform: `translateX(${translateXPx}px)`,
              transition:
                inProgress && !reducedMotion
                  ? `transform ${PILL_TRANSITION_MS}ms ease-out`
                  : "none",
            }}
          >
            {renderedItems.map((item, index) => (
              <ToolPillRow
                key={item.id}
                item={item}
                active={inProgress && item.id === lastItemId}
                showCoupler={index > 0}
              />
            ))}
          </div>
        </div>
      </div>
      {!inProgress ? (
        <div className="flex min-w-0 items-center gap-2 pr-2">
          <span className="label-micro min-w-0 truncate text-basic-tertiary">{label}</span>
          {durationMs != null ? (
            <span className="text-micro shrink-0 whitespace-nowrap text-basic-muted">
              {formatSeconds(durationMs)}
            </span>
          ) : null}
        </div>
      ) : null}
    </button>
  );
}

export default memo(ToolsSegments, toolsSegmentsPropsAreEqual);
