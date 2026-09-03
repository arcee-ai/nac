import { memo, useEffect, useMemo, useRef, useState } from "react";

import ToolPill, { ToolPillSize, ToolPillState } from "@/app/atoms/tool-pill";
import { useIsMobile } from "@/app/hooks/useMediaQuery";
import {
  COUPLER_WIDTH_PX,
  MAX_PILLS_DESKTOP,
  MAX_PILLS_MOBILE,
  PILL_LINGER_MS,
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
      className="h-[1px] shrink-0 bg-[var(--color-border-tertiary)]"
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
        size={ToolPillSize.Small}
        state={
          isActive
            ? ToolPillState.Active
            : pill.failed
              ? ToolPillState.Error
              : ToolPillState.Default
        }
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
  prev: Readonly<ToolsSegmentsProps>,
  next: Readonly<ToolsSegmentsProps>,
): boolean {
  if (
    prev.inProgress !== next.inProgress ||
    prev.active !== next.active ||
    prev.durationMs !== next.durationMs ||
    prev.label !== next.label ||
    prev.className !== next.className ||
    prev.ariaLabel !== next.ariaLabel ||
    prev.onClick !== next.onClick
  ) {
    return false;
  }
  if (prev.items.length !== next.items.length) return false;
  for (let index = 0; index < prev.items.length; index++) {
    if (
      prev.items[index].id !== next.items[index].id ||
      prev.items[index].icon !== next.items[index].icon ||
      prev.items[index].failed !== next.items[index].failed
    ) {
      return false;
    }
  }
  return true;
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
  const showDuration = !inProgress && durationMs != null;
  const [lingering, setLingering] = useState<Map<string, ToolsSegmentItem>>(() => new Map());
  const prevItemsRef = useRef<ToolsSegmentItem[]>(items);
  const timeoutsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const prevLingeringSizeRef = useRef(0);
  const [allowTransition, setAllowTransition] = useState(true);
  const lingeringRef = useRef(lingering);
  lingeringRef.current = lingering;

  useEffect(() => {
    if (!inProgress) {
      timeoutsRef.current.forEach((handle) => clearTimeout(handle));
      timeoutsRef.current.clear();
      setLingering((prev) => (prev.size === 0 ? prev : new Map()));
      prevItemsRef.current = items;
      return;
    }

    const currentIds = new Set(items.map((item) => item.id));
    const dropped = prevItemsRef.current.filter((pill) => !currentIds.has(pill.id));

    if (dropped.length > 0) {
      setLingering((prev) => {
        const next = new Map(prev);
        dropped.forEach((pill) => {
          if (!next.has(pill.id)) next.set(pill.id, pill);
        });
        return next;
      });
      dropped.forEach((pill) => {
        const handle = setTimeout(() => {
          setLingering((prev) => {
            if (!prev.has(pill.id)) return prev;
            const next = new Map(prev);
            next.delete(pill.id);
            return next;
          });
          timeoutsRef.current.delete(pill.id);
        }, PILL_LINGER_MS);
        timeoutsRef.current.set(pill.id, handle);
      });
    }

    const currentLingering = lingeringRef.current;
    const reentered = items.filter((pill) => currentLingering.has(pill.id));
    if (reentered.length > 0) {
      reentered.forEach((pill) => {
        const handle = timeoutsRef.current.get(pill.id);
        if (handle) {
          clearTimeout(handle);
          timeoutsRef.current.delete(pill.id);
        }
      });
      setLingering((prev) => {
        const next = new Map(prev);
        reentered.forEach((pill) => next.delete(pill.id));
        return next;
      });
    }

    prevItemsRef.current = items;
  }, [items, inProgress]);

  useEffect(() => {
    const newSize = lingering.size;
    if (newSize < prevLingeringSizeRef.current) {
      setAllowTransition(false);
      const raf = requestAnimationFrame(() => setAllowTransition(true));
      prevLingeringSizeRef.current = newSize;
      return () => cancelAnimationFrame(raf);
    }
    prevLingeringSizeRef.current = newSize;
  }, [lingering]);

  useEffect(
    () => () => {
      timeoutsRef.current.forEach((handle) => clearTimeout(handle));
      timeoutsRef.current.clear();
    },
    [],
  );

  const lingeringList = useMemo(() => Array.from(lingering.values()), [lingering]);
  const renderedPills = useMemo(() => {
    const idsInItems = new Set(items.map((pill) => pill.id));
    const lingerOnly = lingeringList.filter((pill) => !idsInItems.has(pill.id));
    return [...lingerOnly, ...items];
  }, [lingeringList, items]);

  // Keep every pill in the track. The viewport clips to `maxPills`; extra
  // slots sit off to the left and the strip translates as the queue grows.
  // Slicing first and padding width with `overflowCount` left empty space
  // that `justify-end` shoved into the window whenever +N was showing.
  const overflowCount = Math.max(0, renderedPills.length - maxPills);
  const innerWidthPx = Math.max(0, renderedPills.length * PILL_SLOT_PX - COUPLER_WIDTH_PX);
  const translateXPx = -(overflowCount * PILL_SLOT_PX);
  const lastItemId = items.length > 0 ? items[items.length - 1].id : undefined;
  const reducedMotion = useMemo(() => prefersReducedMotion(), []);

  return (
    <button
      type="button"
      className={cn(
        "inline-flex max-w-full min-w-0 items-center gap-4 rounded-r-full p-2 transition-colors pl-4 border-l-2",
        active
          ? "cursor-pointer btn-secondary-highlighted border-l-primary"
          : "cursor-pointer btn-ghost border-l-tertiary",
        className,
      )}
      aria-pressed={active || undefined}
      aria-label={ariaLabel ?? label}
      onClick={onClick}
    >
      <div className="flex items-center shrink-0">
        {overflowCount > 0 ? (
          <>
            <ToolPill.Overflow count={overflowCount} size={ToolPillSize.Small} />
            <Coupler />
          </>
        ) : null}
        <div
          className="overflow-hidden flex items-center"
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
                inProgress && allowTransition && !reducedMotion
                  ? `transform ${PILL_TRANSITION_MS}ms ease-out`
                  : "none",
            }}
          >
            {renderedPills.map((pill, idx) => (
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
      {!inProgress ? (
        <div className="flex items-center gap-2 min-w-0 pr-2">
          <span className="min-w-0 truncate label-micro text-basic-tertiary">{label}</span>
          {showDuration ? (
            <span className="text-micro text-basic-muted shrink-0 whitespace-nowrap">
              {formatSeconds(durationMs)}
            </span>
          ) : null}
        </div>
      ) : null}
    </button>
  );
}

export default memo(ToolsSegments, toolsSegmentsPropsAreEqual);
